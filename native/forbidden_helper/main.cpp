#include "game/board.h"
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
    std::set<Loc> occupied;
    const json& moves = request["moves"];
    for(std::size_t index = 0; index < moves.size(); index++) {
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
      if(!board.setStone(loc, player))
        throw StringError("failed to place coordinate: " + coordinate);
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

    const json response = {
      {"boardXSize", 15},
      {"boardYSize", 15},
      {"nextPlayer", playerString(nextPlayer)},
      {"forbiddenMoves", forbiddenMoves},
      {"legalMoves", legalMoves},
      {"source", "KataGomo Board::isForbidden()"},
    };
    std::cout << response.dump() << std::endl;
    return 0;
  }
  catch(const std::exception& exception) {
    std::cerr << "forbidden_helper: " << exception.what() << std::endl;
    return 2;
  }
}

