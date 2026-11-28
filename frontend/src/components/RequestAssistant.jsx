import { useId, useState } from "react";
import Icon from "./Icon";
import { useDashboard } from "../hooks/useDashboard";
import { parseSchedulingRequest } from "../services/assistantService";

const EXAMPLE = "45 minutes with Priya next Tuesday afternoon, need a room for 4";

function describePreferences(preferences = {}) {
  const parts = [];

  if (preferences.preferredStartHour !== undefined || preferences.preferredEndHour !== undefined) {
    const from = preferences.preferredStartHour ?? 0;
    const to = preferences.preferredEndHour ?? 24;
    parts.push(`prefer ${String(from).padStart(2, "0")}:00–${String(to).padStart(2, "0")}:00`);
  }
  if (preferences.avoidEarlyMorning) parts.push("not too early");
  if (preferences.avoidLateDay) parts.push("not too late");

  return parts.join(", ");
}

/**
 * "Describe it" box on Find a time (Phase N). The text goes to the server,
 * which asks Gemini to extract the fields and resolves people against
 * registered accounts. Nothing is searched or booked until the user
 * confirms with one of the two buttons.
 */
function RequestAssistant({ onSearch }) {
  const { formatTime, handleApplyAssistantRequest, isSearchingSuggestions } = useDashboard();
  const [text, setText] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState(null);
  const [choices, setChoices] = useState({});
  const inputId = useId();

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setIsReading(true);

    try {
      const result = await parseSchedulingRequest(text);
      setDraft(result.request);
      setChoices({});
    } catch (requestError) {
      setDraft(null);
      setError(requestError.message);
    } finally {
      setIsReading(false);
    }
  }

  function selectedPeople() {
    const people = [];

    for (const participant of draft.participants) {
      if (participant.status === "matched") {
        people.push(participant.matches[0]);
      } else if (participant.status === "ambiguous" && choices[participant.query]) {
        const chosen = participant.matches.find((m) => m.id === choices[participant.query]);
        if (chosen) people.push(chosen);
      }
    }

    return Array.from(new Map(people.map((person) => [person.id, person])).values());
  }

  function apply(search) {
    const people = selectedPeople();

    if (search) {
      onSearch?.();
    }

    handleApplyAssistantRequest(draft, people, { search });
  }

  const unresolved = draft
    ? draft.participants.filter((p) => p.status === "ambiguous" && !choices[p.query])
    : [];
  const preferenceText = draft ? describePreferences(draft.preferences) : "";

  return (
    <section className="panel assistant-panel" aria-labelledby={`${inputId}-heading`}>
      <div className="assistant-head">
        <h2 id={`${inputId}-heading`}>Describe it</h2>
        <span className="assistant-badge mono">Gemini</span>
      </div>

      <form className="assistant-form" onSubmit={handleSubmit}>
        <label className="visually-hidden" htmlFor={inputId}>
          Describe the meeting
        </label>
        <textarea
          id={inputId}
          rows={2}
          maxLength={500}
          value={text}
          placeholder={`e.g. ${EXAMPLE}`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && text.trim().length >= 3) {
              event.preventDefault();
              event.currentTarget.form.requestSubmit();
            }
          }}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={isReading || text.trim().length < 3}
          aria-busy={isReading}
        >
          {isReading ? "Reading…" : "Understand"}
        </button>
      </form>

      <p className="field-hint">
        Your sentence is sent to Google Gemini to pick out the time, length and people. Names are
        matched to ConflictFree accounts on our server.
      </p>

      {error ? (
        <p className="assistant-error" role="alert">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}

      {draft ? (
        <div className="assistant-result" aria-live="polite">
          <dl className="assistant-summary">
            <div>
              <dt>Title</dt>
              <dd>{draft.title}</dd>
            </div>
            <div>
              <dt>Between</dt>
              <dd className="mono">
                {formatTime(draft.windowStart)} – {formatTime(draft.windowEnd)}
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd className="mono">{draft.durationMinutes} min</dd>
            </div>
            {preferenceText ? (
              <div>
                <dt>Preference</dt>
                <dd>{preferenceText}</dd>
              </div>
            ) : null}
            {draft.resource?.type ? (
              <div>
                <dt>Needs</dt>
                <dd>
                  a {draft.resource.type}
                  {draft.resource.attendeeCount ? ` for ${draft.resource.attendeeCount}` : ""}
                </dd>
              </div>
            ) : null}
          </dl>

          {draft.participants.length > 0 ? (
            <ul className="assistant-people">
              {draft.participants.map((participant) => (
                <li key={participant.query}>
                  {participant.status === "matched" ? (
                    <span className="tag tag-free">
                      <Icon name="check" size={14} />
                      {participant.matches[0].name}
                      <span className="visually-hidden"> ({participant.matches[0].email})</span>
                    </span>
                  ) : null}

                  {participant.status === "ambiguous" ? (
                    <fieldset className="assistant-choice">
                      <legend>Which “{participant.query}”?</legend>
                      {participant.matches.map((match) => (
                        <label key={match.id} className="check">
                          <input
                            type="radio"
                            name={`choice-${inputId}-${participant.query}`}
                            value={match.id}
                            checked={choices[participant.query] === match.id}
                            onChange={() =>
                              setChoices((current) => ({ ...current, [participant.query]: match.id }))
                            }
                          />
                          {match.name} <span className="muted">{match.email}</span>
                        </label>
                      ))}
                    </fieldset>
                  ) : null}

                  {participant.status === "not_found" ? (
                    <span className="tag tag-warn">
                      No account for “{participant.query}”, so they won’t be included
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {draft.assumptions.length > 0 || draft.clarification ? (
            <ul className="assistant-notes">
              {draft.assumptions.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {draft.clarification ? <li>{draft.clarification}</li> : null}
            </ul>
          ) : null}

          {unresolved.length > 0 ? (
            <p className="field-hint">
              Choose who you mean above, or they will be left out of the search.
            </p>
          ) : null}

          <div className="button-row">
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => apply(true)}
              disabled={isSearchingSuggestions}
            >
              Search these times
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => apply(false)}>
              Fill the form only
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default RequestAssistant;
