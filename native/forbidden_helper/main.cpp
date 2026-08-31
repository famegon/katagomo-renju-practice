#include "game/board.h"
#include "game/boardhistory.h"
#include "game/rules.h"
#include "external/nlohmann_json/json.hpp"

#include <exception>
#include <iostream>
#include <set>
#include <string>
#include <vector>

using nlohmann::json;

namespace {

Player parsePlayer(const json& value, const std::string& field) {
  if(!value.is_string())
    throw StringError(field + " must be B or W");
  const std::string text = value.get<std::string>();
  if(text == "B")
    return P_BLACK;
  if(text == "W")
    return P_WHITE;
  throw StringError(field + " must be B or W");
}

std::string playerString(Player player) {
  return player == P_BLACK ? "B" : "W";
}

json optionalPlayer(Player player) {
  if(player == P_BLACK)
    return "B";
  if(player == P_WHITE)
    return "W";
  return nullptr;
}

}  // namespace

int main() {
  try {
    json request;
    std::cin >> request;
    if(!request.is_object())
      throw StringError("request must be a JSON object");
    if(request.value("boardXSize", 15) != 15 || request.value("boardYSize", 15) != 15)
      throw StringError("only a 15x15 board is supported");
    if(!request.contains("moves") || !request["moves"].is_array())
      throw StringError("moves must be an array");

    Board::initHash();
    Board board(15, 15);
    // A Renju game cannot continue after all 225 intersections have been
    // filled.  Setting maxMoves to the board area lets the unmodified official
    // BoardHistory/GameLogic path own that draw result as well as line wins and
    // forbidden-move losses.
    const Rules rules(
      Rules::BASICRULE_RENJU,
      Rules::VCNRULE_NOVC,
      false,
      15 * 15
    );
    BoardHistory history(board, P_BLACK, rules);
    std::set<Loc> occupied;
    const json& moves = request["moves"];
    std::string terminalReason;
    json terminalMove = nullptr;
    for(std::size_t index = 0; index < moves.size(); index++) {
      if(history.isGameFinished)
        throw StringError(
          "move " + std::to_string(index + 1) + " was played after the game ended"
        );
      const json& move = moves[index];
      if(!move.is_array() || move.size() != 2)
        throw StringError("each move must be [player, coordinate]");
      const Player player = parsePlayer(move[0], "move player");
      const Player expected = index % 2 == 0 ? P_BLACK : P_WHITE;
      if(player != expected)
        throw StringError("moves must alternate from black");
      if(!move[1].is_string())
        throw StringError("move coordinate must be a string");
      Loc loc = Board::NULL_LOC;
      const std::string coordinate = move[1].get<std::string>();
      if(!Location::tryOfString(coordinate, board, loc) || loc == Board::PASS_LOC)
        throw StringError("invalid 15x15 coordinate: " + coordinate);
      if(!board.isOnBoard(loc) || occupied.find(loc) != occupied.end())
        throw StringError("duplicate or off-board coordinate: " + coordinate);
      occupied.insert(loc);
      if(!history.isLegal(board, loc, player))
        throw StringError("illegal coordinate: " + coordinate);

      // Under Renju, a forbidden black move is a loss. BoardHistory performs
      // the authoritative result update after the stone is played, while this
      // pre-move query preserves the reason that BoardHistory itself does not
      // retain.
      const bool blackForbidden = player == P_BLACK && board.isForbidden(loc);
      history.makeBoardMoveAssumeLegal(board, loc, player);
      if(history.isGameFinished) {
        terminalMove = coordinate;
        if(blackForbidden)
          terminalReason = "black_forbidden";
        else if(history.winner == C_EMPTY)
          terminalReason = "board_full";
        else
          terminalReason = "line_win";
      }
    }

    const Player expectedNext = moves.size() % 2 == 0 ? P_BLACK : P_WHITE;
    const Player nextPlayer = request.contains("nextPlayer")
      ? parsePlayer(request["nextPlayer"], "nextPlayer")
      : expectedNext;
    if(nextPlayer != expectedNext)
      throw StringError(
        "nextPlayer must be " + playerString(expectedNext) + " for this move count"
      );

    std::vector<std::string> forbiddenMoves;
    std::vector<std::string> legalMoves;
    if(!history.isGameFinished) {
      for(int y = 0; y < board.y_size; y++) {
        for(int x = 0; x < board.x_size; x++) {
          const Loc loc = Location::getLoc(x, y, board.x_size);
          if(board.colors[loc] != C_EMPTY)
            continue;
          const std::string coordinate = Location::toString(loc, board);
          const bool forbidden = nextPlayer == P_BLACK && board.isForbidden(loc);
          if(forbidden)
            forbiddenMoves.push_back(coordinate);
          else
            legalMoves.push_back(coordinate);
        }
      }
    }

    std::string outcome = "ongoing";
    if(history.isGameFinished) {
      if(history.winner == P_BLACK)
        outcome = "black_win";
      else if(history.winner == P_WHITE)
        outcome = "white_win";
      else
        outcome = "draw";
    }

    const json response = {
      {"boardXSize", 15},
      {"boardYSize", 15},
      {"rules", "renju"},
      {"isValid", true},
      {"moveCount", moves.size()},
      {"nextPlayer", playerString(nextPlayer)},
      {"isTerminal", history.isGameFinished},
      {"winner", optionalPlayer(history.winner)},
      {"outcome", outcome},
      {"terminalReason", history.isGameFinished ? json(terminalReason) : json(nullptr)},
      {"terminalMove", terminalMove},
      {"forbiddenMoves", forbiddenMoves},
      {"legalMoves", legalMoves},
      {"source", "KataGomo Board::isForbidden()"},
      {"historySource", "KataGomo BoardHistory::makeBoardMoveAssumeLegal()"},
    };
    std::cout << response.dump() << std::endl;
    return 0;
  }
  catch(const std::exception& exception) {
    std::cerr << "forbidden_helper: " << exception.what() << std::endl;
    return 2;
  }
}
