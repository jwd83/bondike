Original prompt: review this seed prompt and build my binary solitaire app

- Initialized project as a static browser app with canvas rendering.
- Goal for first pass: playable Klondike rules, binary card visuals, local font, test hooks (`render_game_to_text`, `advanceTime`).
- TODO: run local server, exercise stock/waste/tableau/foundation interactions, inspect screenshots, fix issues.
- Smoke test passed (deal renders and `render_game_to_text` exports state), but hidden-card pattern text overflowed beyond card bounds.
- Added clipping for face-down card pattern and deterministic URL params (`seed`, `autostart`) to support repeatable test runs.
- Verified tableau move + automatic flip of newly exposed card using deterministic seed (`12345`) via Playwright click choreography.
- Verified stock draw and empty-stock recycle path by clicking stock 26 times; state export confirmed recycle then redraw behavior.
- Verified toolbar buttons: `Auto to Foundation` (graceful no-op when unavailable) and `New Game` (re-deals fresh board).
- No Playwright console/page error logs were emitted during validation runs.
- Updated card face layout: centered the upper decimal rank and upper bit-pip row.
- Added mouse drag-and-drop interactions (drag tableau runs / waste / foundation tops to legal targets) while preserving click-to-select/click-to-move behavior.
- Verified click regressions still pass and validated a deterministic drag move (seed `12345`) via Playwright mouse drag sequence.
- Performed full UI/visual pass: upgraded page chrome, stage framing, HUD chips, board background, and redesigned intro overlay with cleaner typography/layout.
- Fixed intro formatting issues (CTA/control text clipping/wrapping) after visual inspection and follow-up patch.
- Fixed fullscreen behavior by fullscreening the app shell (not only canvas) and adding responsive canvas presentation sizing + button state updates.
- Verified fullscreen interaction path still works by entering fullscreen and drawing from stock (state changed to `moves:1`, `waste:1`).
- TODO (optional): add multi-card auto-complete animation and touch/pointer-event support for mobile drag interactions.
