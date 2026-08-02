"""RUN THE TABLE service layer.

Thin adapter between the pure engine in ``nba_peak.run_the_table`` and the
FastAPI boundary. All game rules live in the engine; this package only shapes
payloads and persists state.
"""
