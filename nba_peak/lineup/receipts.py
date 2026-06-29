"""Deterministic Peak Receipt generation.

No LLM. Every item comes from measured values and explicit thresholds.
Language uses hedged, experimental framing throughout.
"""
from __future__ import annotations

from nba_peak.lineup.config import LINEUP_MODEL_VERSION
from nba_peak.lineup.schemas import CardProfile, LineupDNA, ReceiptItem, SynergyItem

_DNA_LABELS: dict[str, str] = {
    "primary_creation":       "primary creation",
    "scoring_pressure":       "scoring pressure",
    "individual_validation":  "individual validation",
    "postseason_translation": "postseason translation",
    "team_context":           "team context",
    "context_completeness":   "data completeness",
}


def _conf(completeness: float) -> float:
    return round(min(1.0, max(0.0, completeness)), 2)


def generate_receipt(
    cards: list[CardProfile],
    role_assignments: dict[str, str],
    talent_score: float,
    coverage_score: float,
    synergy_items: list[SynergyItem],
    final_dna: LineupDNA,
    lineup_peak_rating: float,
    board_optimum: float | None,
    board_floor: float | None,
    draft_efficiency: float | None,
) -> list[ReceiptItem]:
    items: list[ReceiptItem] = []
    completeness = sum(1.0 for c in cards if c.data_completeness == "complete") / 5.0

    # 1. Talent core
    sorted_cards = sorted(cards, key=lambda c: c.individual_peak_score, reverse=True)
    top = sorted_cards[0]
    items.append(ReceiptItem(
        id="talent_core",
        item_type="talent_core",
        title="Talent core",
        plain_language=(
            f"Within this ruleset, {top.player_name}'s {top.anchor_season} peak "
            f"(PEAK3 score {top.individual_peak_score:.1f}) anchors the lineup's talent layer. "
            f"The model gives this lineup a talent score of {talent_score:.1f}/100."
        ),
        signed_value=talent_score,
        input_ids=[c.peak_window_id for c in sorted_cards],
        rule_id="talent_diminishing_weights",
        model_version=LINEUP_MODEL_VERSION,
        confidence=_conf(completeness),
    ))

    # 2. Strongest DNA capability
    dna_dict = final_dna.as_dict()
    best_dim = max(dna_dict, key=lambda d: dna_dict[d])
    best_val = dna_dict[best_dim]
    items.append(ReceiptItem(
        id="strongest_capability",
        item_type="strength",
        title="Strongest lineup capability",
        plain_language=(
            f"The experimental lineup model gives this lineup its highest coverage score "
            f"in {_DNA_LABELS.get(best_dim, best_dim)} ({best_val:.0f}/100). "
            f"This dimension benefited from multiple contributing peaks."
        ),
        signed_value=best_val,
        input_ids=[c.peak_window_id for c in cards],
        rule_id="coverage_saturation",
        model_version=LINEUP_MODEL_VERSION,
        confidence=_conf(completeness),
    ))

    # 3. Largest weakness
    # Exclude context_completeness from weakness display (it's a data quality signal)
    weakness_dims = {d: v for d, v in dna_dict.items() if d != "context_completeness"}
    worst_dim = min(weakness_dims, key=lambda d: weakness_dims[d])
    worst_val = weakness_dims[worst_dim]
    items.append(ReceiptItem(
        id="largest_weakness",
        item_type="weakness",
        title="Largest modeled weakness",
        plain_language=(
            f"The largest modeled weakness is {_DNA_LABELS.get(worst_dim, worst_dim)} "
            f"({worst_val:.0f}/100). Within this ruleset, no peak in this lineup "
            f"strongly covers this dimension."
        ),
        signed_value=-worst_val,
        input_ids=[c.peak_window_id for c in cards],
        rule_id="coverage_saturation",
        model_version=LINEUP_MODEL_VERSION,
        confidence=_conf(completeness),
    ))

    # 4. Most valuable selection (highest individual peak score)
    items.append(ReceiptItem(
        id="most_valuable_selection",
        item_type="talent_core",
        title="Most consequential selection",
        plain_language=(
            f"The most consequential selection was {top.player_name} "
            f"({top.anchor_season}, PEAK3 score {top.individual_peak_score:.1f}), "
            f"which carries {0.35 * top.individual_peak_score:.1f} points of the talent score alone."
        ),
        signed_value=0.35 * top.individual_peak_score,
        input_ids=[top.peak_window_id],
        rule_id="talent_diminishing_weights",
        model_version=LINEUP_MODEL_VERSION,
        confidence=_conf(top.data_completeness == "complete"),
    ))

    # 5. Synergy items (positive)
    for syn in synergy_items:
        if syn.triggered and syn.rule_type == "positive" and syn.adjustment > 0:
            items.append(ReceiptItem(
                id=f"synergy_{syn.rule_id}",
                item_type="interaction",
                title=f"Positive interaction: {syn.title}",
                plain_language=(
                    f"This lineup gained a positive adjustment from the '{syn.title}' rule. "
                    f"{syn.description} The model gives this a +{syn.adjustment:.1%} modifier."
                ),
                signed_value=syn.adjustment * 100,
                input_ids=[c.peak_window_id for c in cards],
                rule_id=syn.rule_id,
                model_version=LINEUP_MODEL_VERSION,
                confidence=_conf(completeness),
            ))

    # 6. Synergy items (negative)
    for syn in synergy_items:
        if syn.triggered and syn.rule_type == "negative" and syn.adjustment < 0:
            items.append(ReceiptItem(
                id=f"synergy_{syn.rule_id}",
                item_type="interaction",
                title=f"Construction concern: {syn.title}",
                plain_language=(
                    f"This lineup received a negative adjustment for the '{syn.title}' rule. "
                    f"{syn.description} The model gives this a {syn.adjustment:.1%} modifier."
                ),
                signed_value=syn.adjustment * 100,
                input_ids=[c.peak_window_id for c in cards],
                rule_id=syn.rule_id,
                model_version=LINEUP_MODEL_VERSION,
                confidence=_conf(completeness),
            ))

    # 7. Draft efficiency (if available)
    if draft_efficiency is not None and board_optimum is not None and board_floor is not None:
        eff_pct = min(100.0, draft_efficiency * 100)
        items.append(ReceiptItem(
            id="draft_efficiency",
            item_type="efficiency",
            title="Draft efficiency",
            plain_language=(
                f"This lineup captured {eff_pct:.0f}% of the available board value. "
                f"Board optimum: {board_optimum:.1f}, board floor: {board_floor:.1f}, "
                f"your lineup: {lineup_peak_rating:.1f}. "
                f"Draft efficiency = (your rating − floor) / (optimum − floor)."
            ),
            signed_value=eff_pct,
            input_ids=[c.peak_window_id for c in cards],
            rule_id="draft_efficiency_v0",
            model_version=LINEUP_MODEL_VERSION,
            confidence=_conf(completeness),
        ))

    # 8. Data completeness warning
    incomplete = [c for c in cards if c.data_completeness != "complete"]
    if incomplete:
        names = ", ".join(c.player_name for c in incomplete)
        items.append(ReceiptItem(
            id="data_warning",
            item_type="data_warning",
            title="Incomplete data warning",
            plain_language=(
                f"The model notes incomplete data for: {names}. "
                f"Scores for these peaks may be less reliable than fully verified entries."
            ),
            signed_value=None,
            input_ids=[c.peak_window_id for c in incomplete],
            rule_id="data_completeness_check",
            model_version=LINEUP_MODEL_VERSION,
            confidence=0.0,
        ))

    return items
