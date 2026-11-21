import { useEffect, useId, useRef, useState } from "react";
import { searchParticipants } from "../services/participantSearchService";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isParticipantSelected(user, selectedList) {
  const email = (user.email || "").toLowerCase();
  const id = user.id || user._id;

  return selectedList.some((item) => {
    const itemEmail = (item.email || (typeof item === "string" ? item : "")).toLowerCase();
    const itemId = item.id || item._id;

    if (email && itemEmail && email === itemEmail) {
      return true;
    }

    if (id && itemId && String(id) === String(itemId)) {
      return true;
    }

    return false;
  });
}

function isOrganizer(user, organizer) {
  if (!organizer) {
    return false;
  }

  const organizerEmail = (organizer.email || "").toLowerCase();
  const organizerId = organizer.id || organizer._id;
  const userEmail = (user.email || (typeof user === "string" ? user : "")).toLowerCase();
  const userId = user.id || user._id;

  if (organizerEmail && userEmail && organizerEmail === userEmail) {
    return true;
  }

  if (organizerId && userId && String(organizerId) === String(userId)) {
    return true;
  }

  return false;
}

export default function ParticipantPicker({
  selectedParticipants = [],
  onParticipantsChange,
  searchQuery: externalQuery,
  onSearchQueryChange,
  organizer = null,
  disabled = false,
  id = "participant-search-input",
  labelText = "Search participants or Participant user emails (comma-separated registered users)",
}) {
  const [internalQuery, setInternalQuery] = useState("");
  const isControlled = externalQuery !== undefined;
  const query = isControlled ? externalQuery : internalQuery;

  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef(null);
  const debounceTimerRef = useRef(null);
  const abortControllerRef = useRef(null);
  const listboxId = useId();

  function updateQuery(val) {
    if (!isControlled) {
      setInternalQuery(val);
    }
    if (onSearchQueryChange) {
      onSearchQueryChange(val);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Cleanup pending requests on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  function triggerSearch(searchQuery) {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const trimmed = searchQuery.trim();

    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setHasSearched(false);
      setSearchError("");
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    setIsLoading(true);
    setSearchError("");
    setIsOpen(true);
    setActiveIndex(-1);

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const results = await searchParticipants(trimmed, 10, controller.signal);

        // Filter out organizer if present
        const filtered = results.filter(
          (user) => !isOrganizer(user, organizer),
        );

        setSuggestions(filtered);
        setHasSearched(true);
      } catch (err) {
        if (err.name !== "AbortError") {
          setSearchError(err.message || "Failed to search participants");
          setSuggestions([]);
          setHasSearched(true);
        }
      } finally {
        setIsLoading(false);
      }
    }, 300);
  }

  function handleAddParticipant(user) {
    if (!user) {
      return;
    }

    const normalizedUser =
      typeof user === "string"
        ? { id: user, name: user, email: user.toLowerCase(), timezone: "UTC" }
        : {
            id: user.id || user._id || user.email,
            name: user.name || user.email,
            email: (user.email || "").toLowerCase(),
            timezone: user.timezone || "UTC",
          };

    if (isOrganizer(normalizedUser, organizer)) {
      return;
    }

    if (isParticipantSelected(normalizedUser, selectedParticipants)) {
      return;
    }

    const updated = [...selectedParticipants, normalizedUser];
    if (onParticipantsChange) {
      onParticipantsChange(updated);
    }

    updateQuery("");
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    setHasSearched(false);
  }

  function handleRemoveParticipant(participantToRemove) {
    const updated = selectedParticipants.filter((item) => {
      const email = (item.email || (typeof item === "string" ? item : "")).toLowerCase();
      const targetEmail = (
        participantToRemove.email ||
        (typeof participantToRemove === "string" ? participantToRemove : "")
      ).toLowerCase();

      const id = item.id || item._id;
      const targetId = participantToRemove.id || participantToRemove._id;

      if (id && targetId && String(id) === String(targetId)) {
        return false;
      }

      if (email && targetEmail && email === targetEmail) {
        return false;
      }

      return true;
    });

    if (onParticipantsChange) {
      onParticipantsChange(updated);
    }
  }

  function handleInputChange(event) {
    const value = event.target.value;
    updateQuery(value);
    triggerSearch(value);
  }

  function handleKeyDown(event) {
    if (!isOpen) {
      if (event.key === "ArrowDown" && suggestions.length > 0) {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((prev) =>
        prev <= 0 ? suggestions.length - 1 : prev - 1,
      );
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        handleAddParticipant(suggestions[activeIndex]);
      } else if (query.includes(",")) {
        event.preventDefault();
        const tokens = query.split(",").map((t) => t.trim()).filter(Boolean);
        const toAdd = [];
        for (const token of tokens) {
          if (emailRegex.test(token)) {
            const p = {
              id: token.toLowerCase(),
              name: token,
              email: token.toLowerCase(),
              timezone: "UTC",
            };
            if (!isOrganizer(p, organizer) && !isParticipantSelected(p, [...selectedParticipants, ...toAdd])) {
              toAdd.push(p);
            }
          }
        }
        if (toAdd.length > 0) {
          onParticipantsChange?.([...selectedParticipants, ...toAdd]);
          updateQuery("");
          setSuggestions([]);
          setIsOpen(false);
        }
      } else if (emailRegex.test(query.trim())) {
        event.preventDefault();
        handleAddParticipant({
          id: query.trim().toLowerCase(),
          name: query.trim(),
          email: query.trim().toLowerCase(),
          timezone: "UTC",
        });
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="participant-picker" ref={containerRef}>
      <label htmlFor={id} className="participant-picker-label">
        {labelText}
      </label>

      {/* Selected participant chips */}
      {selectedParticipants.length > 0 ? (
        <div
          className="participant-chips-container"
          role="region"
          aria-label="Selected participant chips"
        >
          {selectedParticipants.map((participant) => {
            const displayName = participant.name || participant.email;
            const displayEmail = participant.email;

            return (
              <div
                key={participant.id || participant.email}
                className="selected-participant-chip"
              >
                <div className="chip-info">
                  <span className="chip-name">{displayName}</span>
                  {displayEmail && displayEmail !== displayName ? (
                    <span className="chip-email">({displayEmail})</span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="remove-chip-button"
                  aria-label={`Remove ${displayName}`}
                  disabled={disabled}
                  onClick={() => handleRemoveParticipant(participant)}
                  title={`Remove ${displayName}`}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Search Input & Dropdown */}
      <div className="participant-search-box">
        <input
          id={id}
          type="text"
          className="participant-input"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= 2 && suggestions.length > 0) {
              setIsOpen(true);
            }
          }}
          placeholder="Type at least 2 characters to search by name or email..."
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
        />

        {isOpen ? (
          <div
            id={listboxId}
            className="participant-dropdown"
            role="listbox"
            aria-label="Participant suggestions"
          >
            {isLoading ? (
              <div
                className="participant-dropdown-status"
                role="status"
                aria-live="polite"
              >
                Searching participants...
              </div>
            ) : null}

            {searchError ? (
              <div
                className="participant-dropdown-status participant-dropdown-error"
                role="alert"
              >
                {searchError}
              </div>
            ) : null}

            {!isLoading && !searchError && hasSearched && suggestions.length === 0 ? (
              <div
                className="participant-dropdown-status"
                role="status"
              >
                No registered users found matching "{query.trim()}"
              </div>
            ) : null}

            {!isLoading && !searchError && suggestions.map((suggestion, index) => {
              const isSelected = isParticipantSelected(
                suggestion,
                selectedParticipants,
              );
              const isActive = index === activeIndex;

              return (
                <div
                  id={`${listboxId}-option-${index}`}
                  key={suggestion.id || suggestion.email}
                  className={`participant-dropdown-item ${
                    isActive ? "is-active" : ""
                  } ${isSelected ? "is-disabled" : ""}`}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={isSelected}
                  onClick={() => {
                    if (!isSelected) {
                      handleAddParticipant(suggestion);
                    }
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <div className="participant-item-avatar">
                    {(suggestion.name || suggestion.email || "?")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div className="participant-item-details">
                    <span className="participant-item-name">
                      {suggestion.name || suggestion.email}
                    </span>
                    <span className="participant-item-email">
                      {suggestion.email}
                    </span>
                  </div>
                  {suggestion.timezone ? (
                    <span className="participant-item-tz">
                      {suggestion.timezone}
                    </span>
                  ) : null}
                  {isSelected ? (
                    <span className="participant-item-badge">Added</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <p className="field-hint">
        Type a name or email prefix to add registered ConflictFree participants. You are automatically included.
      </p>
    </div>
  );
}
