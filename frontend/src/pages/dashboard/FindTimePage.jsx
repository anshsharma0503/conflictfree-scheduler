import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../../components/Icon";
import ParticipantPicker from "../../components/ParticipantPicker";
import { useDashboard } from "../../hooks/useDashboard";
import { formatMinutes, getZonedParts } from "../../utils/calendarLayout";
import { formatEventTime } from "../../utils/timezone";

function SlotRow({ slot, rank, isBest, timezone, onSelect }) {
  const start = getZonedParts(slot.startAt, timezone);
  const end = getZonedParts(slot.endAt, timezone);
  const hasScore = typeof slot.score === "number";
  const rowClassName = isBest ? "slot-row is-best" : "slot-row";

  return (
    <button
      type="button"
      className={rowClassName}
      onClick={() => onSelect(slot)}
      title="Use this time in the event form"
    >
      <span className="slot-rank">{String(rank).padStart(2, "0")}</span>

      <span className="slot-main">
        <span className="slot-time-line">
          <span className="slot-time">
            {start ? formatMinutes(start.minutes) : ""}–{end ? formatMinutes(end.minutes) : ""}
          </span>
          <span>{formatEventTime(slot.startAt, timezone, "EEE d MMM yyyy")}</span>
          {isBest ? <span className="best-label">Best match</span> : null}
        </span>

        {slot.reasons?.length || slot.relaxedConstraints?.length || slot.allocatedResource ? (
          <span className="tag-list">
            {slot.reasons?.map((reason, index) => (
              <span key={`reason-${index}`} className="tag">
                {reason}
              </span>
            ))}
            {slot.relaxedConstraints?.map((constraint, index) => (
              <span key={`relaxed-${index}`} className="tag tag-warn">
                {constraint}
              </span>
            ))}
            {slot.allocatedResource ? (
              <span className="tag tag-free">
                Allocated: {slot.allocatedResource.name} ({slot.allocatedResource.type}, cap:{" "}
                {slot.allocatedResource.capacity})
              </span>
            ) : null}
          </span>
        ) : null}

        {slot.allocationReason ? (
          <span className="slot-allocation-reason">{slot.allocationReason}</span>
        ) : null}
      </span>

      {hasScore ? (
        <span className="slot-score">
          <span className="slot-score-label">Score: {slot.score}</span>
          <span className="score-track" aria-hidden="true">
            <span
              className="score-fill"
              style={{ display: "block", width: `${Math.max(0, Math.min(slot.score, 100))}%` }}
            />
          </span>
        </span>
      ) : (
        <span />
      )}

      <span className="slot-action">Select</span>
    </button>
  );
}

function FindTimePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(null);
  const {
    user,
    userTimezone,
    resources,
    slotSearchData,
    handleSlotSearchChange,
    handleAutoAllocateChange,
    handleFindSlots,
    handleFindSuggestions,
    availableSlots,
    hasSearchedSlots,
    isSearchingSlots,
    slotSearchError,
    smartSuggestions,
    suggestionMeta,
    hasSearchedSuggestions,
    isSearchingSuggestions,
    suggestionError,
    handleSelectSlot,
    handleSelectSuggestion,
    selectedParticipants,
    pickedParticipants,
    setPickedParticipants,
    participantSearchQuery,
    setParticipantSearchQuery,
    selectedSlotResource,
    availabilityStale,
    handleRefreshAvailability,
  } = useDashboard();

  const currentTab =
    activeTab ?? (hasSearchedSuggestions && !hasSearchedSlots ? "suggestions" : "slots");
  const showTabs = hasSearchedSlots && hasSearchedSuggestions;
  const showSlots = hasSearchedSlots && currentTab === "slots";
  const showSuggestions = hasSearchedSuggestions && currentTab === "suggestions";

  function onFindSlots(event) {
    setActiveTab("slots");
    handleFindSlots(event);
  }

  function onFindSuggestions(event) {
    setActiveTab("suggestions");
    handleFindSuggestions(event);
  }

  function selectSlot(slot) {
    handleSelectSlot(slot);
    navigate("/dashboard/events/new");
  }

  function selectSuggestion(suggestion) {
    handleSelectSuggestion(suggestion);
    navigate("/dashboard/events/new");
  }

  const relaxedSteps =
    suggestionMeta?.relaxationSteps?.filter(
      (step) => step.level > 0 && step.level <= suggestionMeta.relaxationLevel,
    ) || [];

  return (
    <main className="page">
      <div className="page-header">
        <div>
          <span className="page-kicker">Availability</span>
          <h1>Find a time</h1>
          <p>
            Search a window for conflict-free slots, ranked best first. Selecting one fills
            the event form.
          </p>
        </div>
      </div>

      <div className="split">
        <form
          className="panel finder-form split-side"
          style={{ gap: 0, flexBasis: "340px" }}
          onSubmit={onFindSlots}
          aria-label="Search constraints"
        >
          <div className="panel-section">
            <h2>Window</h2>
            <div className="field-row">
              <label className="field" style={{ flexBasis: "100%" }}>
                Window start
                <input
                  name="windowStart"
                  type="datetime-local"
                  value={slotSearchData.windowStart}
                  onChange={handleSlotSearchChange}
                  required
                />
              </label>
              <label className="field" style={{ flexBasis: "100%" }}>
                Window end
                <input
                  name="windowEnd"
                  type="datetime-local"
                  value={slotSearchData.windowEnd}
                  onChange={handleSlotSearchChange}
                  required
                />
              </label>
              <label className="field">
                Duration (minutes)
                <input
                  name="durationMinutes"
                  type="number"
                  min="1"
                  value={slotSearchData.durationMinutes}
                  onChange={handleSlotSearchChange}
                  required
                />
              </label>
              <label className="field">
                Step (minutes)
                <input
                  name="slotStepMinutes"
                  type="number"
                  min="1"
                  value={slotSearchData.slotStepMinutes}
                  onChange={handleSlotSearchChange}
                />
              </label>
            </div>
          </div>

          <div className="panel-section">
            <h2>Who</h2>
            <ParticipantPicker
              selectedParticipants={pickedParticipants}
              onParticipantsChange={setPickedParticipants}
              searchQuery={participantSearchQuery}
              onSearchQueryChange={setParticipantSearchQuery}
              organizer={user}
              disabled={isSearchingSlots || isSearchingSuggestions}
            />
          </div>

          <div className="panel-section">
            <h2>Room</h2>
            <div className="field-row">
              <label className="field" style={{ flexBasis: "100%" }}>
                Required resource (Optional)
                <select
                  name="resourceId"
                  value={slotSearchData.resourceId}
                  onChange={handleSlotSearchChange}
                  disabled={slotSearchData.autoAllocateResource}
                >
                  <option value="">None</option>
                  {resources.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.name} ({res.type}, cap: {res.capacity})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Required attendees
                <input
                  name="attendeeCount"
                  type="number"
                  min="1"
                  value={slotSearchData.attendeeCount}
                  onChange={handleSlotSearchChange}
                  placeholder="e.g. 4"
                />
              </label>
            </div>

            <label className="check">
              <input
                name="autoAllocateResource"
                type="checkbox"
                checked={slotSearchData.autoAllocateResource}
                onChange={handleAutoAllocateChange}
              />
              Automatically allocate a resource
            </label>

            {slotSearchData.autoAllocateResource ? (
              <label className="field">
                Resource type preference
                <select
                  name="resourceType"
                  value={slotSearchData.resourceType}
                  onChange={handleSlotSearchChange}
                >
                  <option value="">Any type</option>
                  <option value="room">Room</option>
                  <option value="equipment">Equipment</option>
                </select>
              </label>
            ) : null}
          </div>

          <div className="panel-section">
            <fieldset>
              <legend>Preferences &amp; ranking</legend>
              <div className="field-row" style={{ marginBottom: 12 }}>
                <label className="field">
                  Preferred start hour
                  <input
                    name="preferredStartHour"
                    type="number"
                    min="0"
                    max="23"
                    placeholder="e.g. 13"
                    value={slotSearchData.preferredStartHour}
                    onChange={handleSlotSearchChange}
                  />
                </label>
                <label className="field">
                  Preferred end hour
                  <input
                    name="preferredEndHour"
                    type="number"
                    min="0"
                    max="23"
                    placeholder="e.g. 17"
                    value={slotSearchData.preferredEndHour}
                    onChange={handleSlotSearchChange}
                  />
                </label>
              </div>

              <div className="check-group" style={{ marginBottom: 12 }}>
                <label className="check">
                  <input
                    name="avoidEarlyMorning"
                    type="checkbox"
                    checked={slotSearchData.avoidEarlyMorning}
                    onChange={handleSlotSearchChange}
                  />
                  Avoid early morning (&lt; 10:00 AM)
                </label>
                <label className="check">
                  <input
                    name="avoidLateDay"
                    type="checkbox"
                    checked={slotSearchData.avoidLateDay}
                    onChange={handleSlotSearchChange}
                  />
                  Avoid late day (&gt; 5:00 PM)
                </label>
                <label className="check">
                  <input
                    name="earliestSlotBonus"
                    type="checkbox"
                    checked={slotSearchData.earliestSlotBonus}
                    onChange={handleSlotSearchChange}
                  />
                  Earliest slot bonus
                </label>
              </div>

              <div className="field-row">
                <label className="field">
                  Minimum score
                  <input
                    name="minimumScore"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="e.g. 70"
                    value={slotSearchData.minimumScore}
                    onChange={handleSlotSearchChange}
                  />
                </label>
                <label className="field">
                  Max suggestions
                  <input
                    name="maxSuggestions"
                    type="number"
                    min="1"
                    placeholder="3"
                    value={slotSearchData.maxSuggestions}
                    onChange={handleSlotSearchChange}
                  />
                </label>
              </div>
            </fieldset>
          </div>

          <div className="panel-footer" style={{ flexDirection: "column", alignItems: "stretch" }}>
            {slotSearchError ? (
              <p className="form-error" role="alert">
                {slotSearchError}
              </p>
            ) : null}
            {suggestionError ? (
              <p className="form-error" role="alert">
                {suggestionError}
              </p>
            ) : null}
            <button className="btn btn-primary" type="submit" disabled={isSearchingSlots}>
              {isSearchingSlots ? "Searching slots..." : "Find available slots"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={isSearchingSuggestions}
              onClick={onFindSuggestions}
            >
              {isSearchingSuggestions ? "Finding suggestions..." : "Find smart suggestions"}
            </button>
          </div>
        </form>

        <section className="split-main" aria-label="Results">
          {selectedParticipants.length > 0 ? (
            <aside
              className="panel panel-body participant-summary"
              role="region"
              aria-label="Coordinated participants"
            >
              <div className="participant-summary-header">
                <span className="participant-summary-title">Coordinated Participants</span>
                <span className="participant-count">
                  {selectedParticipants.length} user{selectedParticipants.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="participant-grid">
                {selectedParticipants.map((p, pIndex) => (
                  <div key={p.id || p.email} className="participant-card">
                    <span className="participant-name">
                      {p.name || p.email} {pIndex === 0 ? "(You)" : ""}
                    </span>
                    <span className="participant-email">{p.email}</span>
                    <span className="participant-tz">{p.timezone}</span>
                  </div>
                ))}
              </div>
              <p className="field-hint">
                Slots below are free for everyone listed. Invitations are sent when you confirm
                the meeting.
              </p>
            </aside>
          ) : null}

          {selectedSlotResource ? (
            <div className="resource-summary" role="region" aria-label="Selected slot resource">
              <Icon name="door" size={16} />
              <span>
                Resource: <strong>{selectedSlotResource.name}</strong> (
                {selectedSlotResource.type}, cap: {selectedSlotResource.capacity})
              </span>
            </div>
          ) : null}

          {availabilityStale ? (
            <div className="stale-notice" role="status">
              <span>
                Calendars or bookings changed since this search. These results may be out of
                date.
              </span>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={handleRefreshAvailability}
                disabled={isSearchingSlots || isSearchingSuggestions}
              >
                Search again
              </button>
            </div>
          ) : null}

          {hasSearchedSlots || hasSearchedSuggestions ? (
            <div className="panel">
              {showTabs ? (
                <div className="result-tabs" role="tablist" aria-label="Result type">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={currentTab === "slots"}
                    onClick={() => setActiveTab("slots")}
                  >
                    Ranked slots <span className="mono">{availableSlots.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={currentTab === "suggestions"}
                    onClick={() => setActiveTab("suggestions")}
                  >
                    Smart Suggestions <span className="mono">{smartSuggestions.length}</span>
                  </button>
                </div>
              ) : (
                <div className="panel-header">
                  <h2>{currentTab === "suggestions" ? "Smart Suggestions" : "Ranked Available Slots"}</h2>
                  <span className="muted mono">
                    {currentTab === "suggestions" ? smartSuggestions.length : availableSlots.length}{" "}
                    found
                  </span>
                </div>
              )}

              {showSlots ? (
                availableSlots.length > 0 ? (
                  <div className="slot-list" role="region" aria-label="Available slots">
                    {availableSlots.map((slot, index) => (
                      <SlotRow
                        key={`${slot.startAt}-${slot.endAt}-${index}`}
                        slot={slot}
                        rank={index + 1}
                        isBest={index === 0 && typeof slot.score === "number"}
                        timezone={userTimezone}
                        onSelect={selectSlot}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="empty-state">No available slots found</p>
                )
              ) : null}

              {showSuggestions ? (
                <>
                  {suggestionMeta?.relaxed ? (
                    <aside className="relaxation-notice" role="note" aria-label="Relaxation notice">
                      <p>
                        <strong>No strict match found. Constraints relaxed:</strong>
                      </p>
                      <div className="tag-list">
                        {relaxedSteps.map((step) => (
                          <span key={step.level} className="tag tag-warn">
                            {step.label}
                          </span>
                        ))}
                      </div>
                    </aside>
                  ) : null}

                  {smartSuggestions.length > 0 ? (
                    <div className="slot-list" role="region" aria-label="Smart suggestions">
                      {smartSuggestions.map((suggestion, index) => (
                        <SlotRow
                          key={`${suggestion.startAt}-${suggestion.endAt}-${index}`}
                          slot={suggestion}
                          rank={index + 1}
                          isBest={index === 0 && typeof suggestion.score === "number"}
                          timezone={userTimezone}
                          onSelect={selectSuggestion}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">No smart suggestions found</p>
                  )}
                </>
              ) : null}
            </div>
          ) : (
            <div className="panel">
              <div className="empty-state">
                Set a window and press <strong>Find available slots</strong> for every free time,
                or <strong>Find smart suggestions</strong> for the best few, relaxing preferences
                if nothing fits.
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default FindTimePage;
