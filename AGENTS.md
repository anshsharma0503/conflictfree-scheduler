# ConflictFree Development Instructions

## Project Goal

Build ConflictFree from scratch according to the project proposal and the documents inside `docs/`.

ConflictFree is a smart scheduling and resource allocation application. It will help users authenticate, connect calendars, create events, detect scheduling conflicts, manage resources, and eventually receive intelligent scheduling suggestions.

## Development Rules

- Use JavaScript and JSX only.
- Do not use TypeScript.
- Do not copy code from any previous implementation.
- The project proposal and `docs/REQUIREMENTS.md` are the product source of truth.
- Work on one feature slice at a time.
- For each feature, prefer this sequence:
  backend → automated tests → manual/API testing → frontend → frontend tests → end-to-end testing.
- The user may personally create and edit application files.
- When giving implementation instructions, provide exact file paths and complete code.
- Explain where code must be inserted, replaced, or removed.
- Provide commands for the user to run and expected results.
- Never claim code works until it has been run successfully.
- Do not begin a new feature until the current feature completion gate passes.
- Use local MongoDB Community Server for development.
- Docker is deferred for now.

## Documentation Rules

Keep these documents accurate as the project changes:

- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/PROGRESS.md`
- `docs/DECISIONS.md`

Documentation must describe implemented behavior separately from planned behavior.