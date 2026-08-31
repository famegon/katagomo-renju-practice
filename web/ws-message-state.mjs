import { isAnalysisResponseCurrent } from "./session-state.mjs";

const LIVE_ANALYSIS_STATES = new Set(["requested", "streaming"]);

function immutableDecision(kind) {
  return Object.freeze({ kind });
}
function jobIsLive(job) {
  return Boolean(job && LIVE_ANALYSIS_STATES.has(job.state));
}

function targetsCurrentJob(job, message, currentIdentity) {
  return Boolean(job && isAnalysisResponseCurrent(job, message, currentIdentity));
}

function analysisMetadataMatches(message, job, context) {
  return Number(message.positionRevision) === job.positionRevision
    && Number(message.positionMoveCount) === context.ply
    && (message.noResults === true || Number(message.turnNumber) === context.ply)
    && Number(message.requestedMaxVisits) === job.requestedMaxVisits
    && message.analysisPurpose === job.analysisPurpose
    && (message.sessionEpoch ?? null) === job.sessionEpoch;
}

/**
 * Decide how the browser should route one decoded WebSocket JSON object.
 * This function owns message identity, targeted-error, terminal, metadata, and
 * noResults decisions; DOM mutation and AnalysisJob transitions stay in app.js.
 */
export function decideWebSocketMessage({
  message,
  job = null,
  analysisContext = null,
  currentIdentity,
  currentPositionKey,
  positionIsTerminal = false,
} = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return immutableDecision("ignore");
  }

  if (message.type === "position") {
    if (!analysisContext || !targetsCurrentJob(job, message, currentIdentity)) {
      return immutableDecision("ignore");
    }
    return immutableDecision(message.gameState?.isTerminal === true
      ? "position-terminal" : "position-invalid");
  }

  if (message.type === "warning") {
    return immutableDecision(targetsCurrentJob(job, message, currentIdentity)
      ? "warning-current" : "ignore");
  }

  if (message.type === "error") {
    const targeted = jobIsLive(job)
      && typeof message.clientRequestId === "string"
      && message.clientRequestId === job.clientRequestId;
    if (targeted) return immutableDecision("error-current");
    if (jobIsLive(job) && !message.clientRequestId) {
      return immutableDecision("error-auxiliary");
    }
    return immutableDecision("ignore");
  }

  if (message.type === "status") {
    if (message.status === "analyzing") {
      return immutableDecision(targetsCurrentJob(job, message, currentIdentity)
        ? "status-analyzing" : "status-engine-only");
    }
    if (message.status === "canceled") {
      const matchedCancel = job?.state === "canceled"
        && message.clientRequestId === job.clientRequestId;
      return immutableDecision(matchedCancel ? "status-canceled" : "status-engine-only");
    }
    if (["idle", "connected"].includes(message.status) && !jobIsLive(job)) {
      return immutableDecision(message.status === "connected"
        ? "status-connected" : "status-idle");
    }
    return immutableDecision("status-engine-only");
  }

  if (message.type !== "analysis" || !job || !analysisContext) {
    return immutableDecision("ignore");
  }
  if (positionIsTerminal) return immutableDecision("analysis-after-terminal");
  if (!targetsCurrentJob(job, message, currentIdentity)) return immutableDecision("ignore");
  if (analysisContext.positionKey !== currentPositionKey) return immutableDecision("ignore");
  if (!analysisMetadataMatches(message, job, analysisContext)) {
    return immutableDecision("analysis-metadata-mismatch");
  }
  if (message.noResults === true) return immutableDecision("analysis-no-results");
  return immutableDecision(message.isFinal === true ? "analysis-final" : "analysis-partial");
}
