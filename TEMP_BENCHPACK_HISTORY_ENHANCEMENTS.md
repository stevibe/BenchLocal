# Bench Pack History / Run Enhancements

Temporary working note for the current BenchLocal UI changes.

## Scope

Three related improvements are planned:

1. Auto-focus the currently running scenario column so the scenario detail pane follows live execution.
2. Allow incomplete history runs to be resumed in-place.
3. Add a replay mode for completed runs for screen recording.

## Implementation Order

1. Resume incomplete runs from history
2. Auto-focus the currently running scenario
3. Replay mode via `Shift + Open`

The order is intentional. Resume changes the meaning of a loaded history run, so it should define the history-state model first. Auto-focus is independent. Replay can then reuse the richer loaded-history state.

## Resume Incomplete Runs

### Current behavior

- Loading a history sets the tab into a generic history mode.
- The main `Run` button is disabled in history mode.
- A stopped or errored run has no whole-run continuation path.

### Target behavior

- If the loaded history is incomplete, the main action becomes available.
- The button label becomes `Resume Test`.
- Clicking it:
  - clears the visible history banner
  - keeps the same `runId`
  - keeps the same run history entry
  - executes only missing model/scenario cells
  - preserves already completed cells
  - uses the historical model set from the loaded run
  - uses the loaded run's execution mode unless the user explicitly changed the tab configuration before resuming

### Notes

- A run is "complete" only when every scenario/model cell in the historical run matrix has a stored result.
- Resume should not create a new history entry.
- Resume should emit normal run progress events so the UI behaves like a live run.

## Auto-Focus Current Scenario

### Target behavior

- While a run is live, the focused scenario should follow the most recent scenario activity.
- For parallel modes, focus should follow the most recent relevant event, not all active cells simultaneously.
- Manual user clicks can still change focus, but incoming live activity may move focus again.

## Replay Mode

### Activation

- Open the history dialog.
- Hold `Shift`.
- Click `Open`.

### Target behavior

- Only completed runs can replay.
- Replay hides the history banner.
- The main action label becomes `Replay`.
- Replay does not call the host runner or verifier.
- Replay uses the stored execution mode to determine the reveal order.
- Each cell shows a spinner for roughly one second before the stored result appears.

