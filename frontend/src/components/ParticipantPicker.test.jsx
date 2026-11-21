import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ParticipantPicker from "./ParticipantPicker";
import * as searchService from "../services/participantSearchService";

vi.mock("../services/participantSearchService", () => ({
  searchParticipants: vi.fn(),
}));

describe("ParticipantPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("search starts only after at least two characters are typed", async () => {
    searchService.searchParticipants.mockResolvedValue([
      {
        id: "user-1",
        name: "Raj Patel",
        email: "raj@example.com",
        timezone: "Asia/Kolkata",
      },
    ]);

    render(<ParticipantPicker selectedParticipants={[]} onParticipantsChange={vi.fn()} />);

    const input = screen.getByRole("combobox");

    // Type 1 character: should not trigger search
    fireEvent.change(input, { target: { value: "r" } });

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(searchService.searchParticipants).not.toHaveBeenCalled();

    // Type 2nd character: should trigger search
    fireEvent.change(input, { target: { value: "ra" } });

    await waitFor(() => {
      expect(searchService.searchParticipants).toHaveBeenCalledWith(
        "ra",
        10,
        expect.any(AbortSignal),
      );
    });
  });

  test("displays loading state and no-results UI", async () => {
    let resolveSearch;
    searchService.searchParticipants.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );

    render(<ParticipantPicker selectedParticipants={[]} onParticipantsChange={vi.fn()} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "no-match" } });

    // Should show loading status while request is in flight
    expect(screen.getByText(/Searching participants.../i)).toBeInTheDocument();

    // Wait until searchParticipants is called by the debounce timer
    await waitFor(() => {
      expect(typeof resolveSearch).toBe("function");
    });

    // Resolve with empty results
    resolveSearch([]);

    // Should show no matching users message
    await waitFor(() => {
      expect(
        screen.getByText(/No registered users found matching "no-match"/i),
      ).toBeInTheDocument();
    });
  });

  test("displays error state when search fails", async () => {
    searchService.searchParticipants.mockRejectedValue(
      new Error("Network connection error"),
    );

    render(<ParticipantPicker selectedParticipants={[]} onParticipantsChange={vi.fn()} />);

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "error-query" } });

    await waitFor(() => {
      expect(
        screen.getByText(/Network connection error/i),
      ).toBeInTheDocument();
    });
  });

  test("selecting a suggestion adds a participant chip", async () => {
    const candidate = {
      id: "part-1",
      name: "Raj Patel",
      email: "raj@example.com",
      timezone: "Asia/Kolkata",
    };

    searchService.searchParticipants.mockResolvedValue([candidate]);
    const onParticipantsChange = vi.fn();

    render(
      <ParticipantPicker
        selectedParticipants={[]}
        onParticipantsChange={onParticipantsChange}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "raj" } });

    await waitFor(() => {
      expect(screen.getByText("Raj Patel")).toBeInTheDocument();
    });

    const suggestion = screen.getByRole("option", { name: /Raj Patel/i });
    fireEvent.click(suggestion);

    expect(onParticipantsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "part-1",
        name: "Raj Patel",
        email: "raj@example.com",
        timezone: "Asia/Kolkata",
      }),
    ]);
  });

  test("blocks duplicate participant selection", async () => {
    const existing = {
      id: "part-1",
      name: "Raj Patel",
      email: "raj@example.com",
      timezone: "Asia/Kolkata",
    };

    searchService.searchParticipants.mockResolvedValue([existing]);
    const onParticipantsChange = vi.fn();

    render(
      <ParticipantPicker
        selectedParticipants={[existing]}
        onParticipantsChange={onParticipantsChange}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "raj" } });

    await waitFor(() => {
      expect(screen.getByText("Added")).toBeInTheDocument();
    });

    const suggestion = screen.getByRole("option", { name: /Raj Patel/i });
    fireEvent.click(suggestion);

    // Should not call onParticipantsChange with duplicate
    expect(onParticipantsChange).not.toHaveBeenCalled();
  });

  test("removing a selected chip removes that participant", async () => {
    const participant1 = {
      id: "part-1",
      name: "Raj Patel",
      email: "raj@example.com",
      timezone: "Asia/Kolkata",
    };
    const participant2 = {
      id: "part-2",
      name: "Sarah Connor",
      email: "sarah@example.com",
      timezone: "America/New_York",
    };

    const onParticipantsChange = vi.fn();

    render(
      <ParticipantPicker
        selectedParticipants={[participant1, participant2]}
        onParticipantsChange={onParticipantsChange}
      />,
    );

    expect(screen.getByText("Raj Patel")).toBeInTheDocument();
    expect(screen.getByText("Sarah Connor")).toBeInTheDocument();

    const removeRajButton = screen.getByRole("button", {
      name: "Remove Raj Patel",
    });
    fireEvent.click(removeRajButton);

    expect(onParticipantsChange).toHaveBeenCalledWith([participant2]);
  });

  test("supports keyboard navigation with ArrowDown, ArrowUp, Enter, and Escape", async () => {
    const suggestions = [
      {
        id: "user-1",
        name: "Raj Patel",
        email: "raj@example.com",
        timezone: "Asia/Kolkata",
      },
      {
        id: "user-2",
        name: "Sarah Connor",
        email: "sarah@example.com",
        timezone: "America/New_York",
      },
    ];

    searchService.searchParticipants.mockResolvedValue(suggestions);
    const onParticipantsChange = vi.fn();

    render(
      <ParticipantPicker
        selectedParticipants={[]}
        onParticipantsChange={onParticipantsChange}
      />,
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "sa" } });

    await waitFor(() => {
      expect(screen.getByText("Raj Patel")).toBeInTheDocument();
      expect(screen.getByText("Sarah Connor")).toBeInTheDocument();
    });

    // Arrow down to highlight first suggestion
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const option1 = screen.getByRole("option", { name: /Raj Patel/i });
    expect(option1).toHaveClass("is-active");

    // Arrow down to highlight second suggestion
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const option2 = screen.getByRole("option", { name: /Sarah Connor/i });
    expect(option2).toHaveClass("is-active");

    // Press Enter to select highlighted suggestion (Sarah Connor)
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onParticipantsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "user-2",
        name: "Sarah Connor",
        email: "sarah@example.com",
      }),
    ]);

    // Escape closes the listbox
    fireEvent.change(input, { target: { value: "sa" } });
    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
