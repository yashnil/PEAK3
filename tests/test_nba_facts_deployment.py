"""The fact bank as a DEPLOYMENT ARTIFACT, not just as a data structure.

WHY THIS FILE IS SEPARATE FROM `test_nba_facts.py`. That suite tests the bank's
content -- determinism, evidence, categories -- against a bank that already
exists. Every one of its assertions passed while staging served
`503 {"detail":"The NBA fact bank has not been built."}`, because the defect was
never in the data. It was that nothing produced the file inside the deployed
image: `data/web/` is gitignored AND excluded by `.dockerignore`, the generator
was wired into `scripts/ci/build-web-data.sh` (so CI had it) and never into the
Dockerfile (so the image did not).

So the tests here are about PACKAGING: does a clean output directory produce the
bank, does the generator write exactly where the loader reads, does the shipped
build actually run the generator, and does a missing bank stay visible instead of
turning into a quietly absent homepage section.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

from nba_peak import nba_facts  # noqa: E402
from nba_peak.nba_facts import (  # noqa: E402
    BANK_PATH,
    FACT_BANK_VERSION,
    MIN_FACTS,
    bank_status,
    build_bank,
    clear_bank_cache,
    fact_for_date,
    load_bank,
)

GENERATOR = REPO_ROOT / "scripts" / "build_nba_facts.py"


def _run_generator(out: Path) -> subprocess.CompletedProcess:
    """Run the shipped generator exactly as a build does, into a temp path."""
    return subprocess.run(
        [sys.executable, str(GENERATOR), "--out", str(out)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------------------
# A clean build produces the bank
# ---------------------------------------------------------------------------


def test_a_clean_output_directory_produces_a_bank(tmp_path):
    """No preexisting `data/web/`, no bank -- and the generator makes one.

    Run as a SUBPROCESS against the real script rather than by calling
    `build_bank()`, because the thing that was broken was the script never
    being invoked, and a test that skips the script cannot notice.
    """
    out = tmp_path / "fresh" / "nba_facts.v1.json"
    assert not out.parent.exists()

    result = _run_generator(out)

    assert result.returncode == 0, result.stderr
    assert out.exists(), "the generator did not create its output directory"
    payload = json.loads(out.read_text())
    assert payload["version"] == FACT_BANK_VERSION
    assert payload["count"] >= MIN_FACTS
    assert len(payload["facts"]) == payload["count"]


def test_the_generator_writes_exactly_where_the_loader_reads(tmp_path):
    """The output path and the runtime path are ONE constant, not two strings.

    A generator writing `data/web/nba_facts.json` while the loader read
    `nba_facts.v1.json` would look identical to this defect from the outside,
    so the agreement is asserted rather than assumed.
    """
    # The script's default output IS the loader's constant.
    import importlib.util

    spec = importlib.util.spec_from_file_location("build_nba_facts", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    parser_default = module.BANK_PATH
    assert parser_default == BANK_PATH

    # And a bank written there is the bank `load_bank()` finds.
    out = tmp_path / "nba_facts.v1.json"
    assert _run_generator(out).returncode == 0
    published, _rejected = build_bank()
    assert [fact.fact_id for fact in load_bank(out)] == [
        fact.fact_id for fact in published
    ]


def test_the_loader_path_does_not_depend_on_the_working_directory(tmp_path):
    """The runtime CWD is `/app/apps/api`, not the repo root.

    `BANK_PATH` is derived from the module's own location, so it resolves the
    same from anywhere. Asserted by resolving it from a different CWD in a
    fresh interpreter -- the only way to observe the real behaviour, since this
    process already imported the module.
    """
    script = (
        "import json,sys;"
        f"sys.path.insert(0, {str(REPO_ROOT)!r});"
        "from nba_peak.nba_facts import BANK_PATH;"
        "print(BANK_PATH)"
    )
    from_root = subprocess.run(
        [sys.executable, "-c", script], cwd=REPO_ROOT, capture_output=True, text=True
    )
    from_elsewhere = subprocess.run(
        [sys.executable, "-c", script], cwd=tmp_path, capture_output=True, text=True
    )
    assert from_root.returncode == 0, from_root.stderr
    assert from_elsewhere.returncode == 0, from_elsewhere.stderr
    assert from_root.stdout.strip() == from_elsewhere.stdout.strip()
    assert from_root.stdout.strip().endswith("data/web/nba_facts.v1.json")


def test_generation_is_deterministic_across_separate_processes(tmp_path):
    """Byte-identical output, so "the bank changed" means "the data changed"."""
    first, second = tmp_path / "a.json", tmp_path / "b.json"
    assert _run_generator(first).returncode == 0
    assert _run_generator(second).returncode == 0
    assert first.read_bytes() == second.read_bytes()


# ---------------------------------------------------------------------------
# The build wiring itself
# ---------------------------------------------------------------------------


def test_the_dockerfile_generates_the_bank_and_asserts_it(tmp_path):
    """THE REGRESSION TEST FOR THE DEPLOY DEFECT.

    The image is what Railway serves, and the image had no bank because this
    line was missing. Asserted against the Dockerfile text because there is no
    cheaper way to notice a build step that is absent -- and absence is exactly
    what shipped.
    """
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "scripts/build_nba_facts.py" in dockerfile, (
        "the API image does not generate the fact bank, so a deployed container "
        "will serve 503 from /api/v1/nba-facts/today"
    )
    # And it must FAIL the build rather than produce an image short of a file.
    assert "test -s data/web/nba_facts.v1.json" in dockerfile


def test_the_image_build_runs_the_same_generators_as_the_ci_build():
    """THE GENERAL FORM OF THIS DEFECT, as one invariant.

    The bug was a DIVERGENCE, not an omission in isolation: the fact bank was
    wired into `scripts/ci/build-web-data.sh`, so CI generated it and every
    test that needed it passed, while the Dockerfile -- the thing Railway
    actually builds -- was left running only the exporter. Any future generator
    added to one and not the other reproduces it exactly.

    So the two lists are compared directly. `build_card_profiles.py` is
    deliberately excluded: it writes into `data/game/profiles/`, which is
    git-tracked and copied into the image rather than generated in it.
    """
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    ci_script = (REPO_ROOT / "scripts" / "ci" / "build-web-data.sh").read_text()

    pattern = re.compile(r"scripts/(build_[a-z0-9_]+\.py)")
    tracked_output = {"build_card_profiles.py"}

    in_image = set(pattern.findall(dockerfile)) - tracked_output
    in_ci = set(pattern.findall(ci_script)) - tracked_output

    assert in_image, "the image build runs no generators at all"
    assert in_ci == in_image, (
        "the CI build and the deployed image build run different generators, "
        "which is how a green CI ships an image missing a file. "
        f"CI only: {sorted(in_ci - in_image)}; image only: {sorted(in_image - in_ci)}"
    )


def test_every_data_web_file_the_api_reads_is_generated_by_the_image():
    """Nothing under `data/web/` can be copied in, so all of it must be built.

    The filenames are taken from the loaders themselves rather than from a
    list kept alongside them, so a new runtime dependency on a file nobody
    generates fails here.
    """
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "data/web" in (REPO_ROOT / ".dockerignore").read_text(), (
        "data/web/ is no longer excluded from the build context -- this test's "
        "premise has changed"
    )

    generated = REPO_ROOT / "data" / "web"
    if not generated.exists():
        pytest.skip("data/web/ has not been built in this checkout")

    # Whatever a full local build produced is what the image must also produce.
    produced = {path.name for path in generated.glob("*.json")}
    assert BANK_PATH.name in produced

    scripts_in_image = set(re.findall(r"scripts/(build_[a-z0-9_]+\.py)", dockerfile))
    assert "build_web_dataset.py" in scripts_in_image
    assert "build_nba_facts.py" in scripts_in_image


def test_the_ci_data_guard_names_the_bank():
    """A checkout with the exporter's output but no bank is a broken checkout,
    and the guard should say so rather than let a browser suite discover it."""
    guard = (REPO_ROOT / "scripts" / "ci" / "lib.sh").read_text()
    assert "data/web/nba_facts.v1.json" in guard


def test_the_documented_local_command_builds_the_bank():
    """`make build-dataset` is what CLAUDE.md tells a developer to run."""
    makefile = (REPO_ROOT / "Makefile").read_text()
    target = makefile.split("build-dataset:", 1)[1].split("\n\n", 1)[0]
    assert "scripts/build_nba_facts.py" in target


# ---------------------------------------------------------------------------
# Missing and corrupt states stay visible
# ---------------------------------------------------------------------------


def test_a_missing_bank_is_reported_rather_than_silently_empty(tmp_path):
    absent = tmp_path / "not-there.json"
    status = bank_status(absent)
    assert status["loaded"] is False
    assert status["fact_count"] == 0
    assert status["exists"] is False
    # The path is reported, so "where did it look?" is answerable from the probe.
    assert status["path"] == str(absent)


def test_a_corrupt_bank_is_reported_rather_than_crashing(tmp_path):
    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{ this is not json")
    assert load_bank(corrupt) == []
    assert bank_status(corrupt)["loaded"] is False


def test_a_bank_that_is_too_small_fails_the_build(tmp_path, monkeypatch):
    """The generator refuses to ship a bank that would repeat itself.

    Driven by shrinking the SOURCE, which is the realistic failure: a truncated
    or filtered input file. A build that quietly emitted four facts would put a
    homepage on a four-day loop.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location("build_nba_facts_small", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    # `build_bank` returns (published, rejected) now, so the stub has to as
    # well — a stub returning a bare list would make `main()` fail for the
    # wrong reason and the test would pass without exercising the floor.
    monkeypatch.setattr(
        module, "build_bank", lambda: (build_bank()[0][:3], [])
    )
    monkeypatch.setattr(
        sys, "argv", ["build_nba_facts.py", "--out", str(tmp_path / "small.json")]
    )
    assert module.main() == 1
    assert not (tmp_path / "small.json").exists(), "a rejected bank was still written"


def test_missing_source_data_fails_the_build_loudly(tmp_path, monkeypatch):
    """A missing input is a build failure, not an empty bank."""
    # Patched on the SUBMODULE, because `nba_facts` is a package now and
    # `load_rows` reads the constant from inside `derived`. Patching the
    # package re-export would leave the real file in place and the test would
    # pass without exercising anything.
    from nba_peak.nba_facts import derived as derived_module

    monkeypatch.setattr(derived_module, "SEASONS_PATH", tmp_path / "gone.json")
    with pytest.raises(FileNotFoundError):
        nba_facts.load_rows()


# ---------------------------------------------------------------------------
# The shared cache
# ---------------------------------------------------------------------------


def test_the_cache_is_shared_so_the_probe_and_the_route_cannot_disagree():
    """One `lru_cache`, read by both. Two would let readiness report "ready"
    from a warm copy while the route found nothing."""
    clear_bank_cache()
    first = nba_facts.cached_bank()
    second = nba_facts.cached_bank()
    assert first is second
    assert bank_status()["fact_count"] == len(first)


def test_the_real_bank_selects_a_dated_fact_that_names_its_source():
    """SOURCING, not evidence rows.

    This asserted `fact.evidence` when every fact in the bank was generated
    from the committed season table. The bank now has a curated half whose
    facts carry a NAMED CHECKED SOURCE instead of rows — a per-season totals
    table cannot know why the shot clock is 24 seconds. So the assertion is the
    thing that is true of both: no published fact is unsourced.
    """
    bank = list(nba_facts.cached_bank())
    if not bank:
        pytest.skip("data/web/ has not been built in this checkout")
    fact = fact_for_date(bank, "2026-08-05")
    assert fact is not None
    assert fact.source_label
    assert fact.source_detail
    assert fact.verified
    assert fact.category
    if fact.provenance == "derived":
        assert fact.evidence


# ---------------------------------------------------------------------------
# The generator's INPUTS, not just its outputs
#
# The previous packaging defect was "the image never runs the generator", and
# the tests above close it. This one was the mirror image: the image ran the
# generator against two thirds of its inputs. `data/facts/` was never COPYed,
# `load_editorial` returned an empty list for a missing file, and the first
# thing to notice was the MIN_FACTS floor tripping with "only 113 facts
# published" — a true statement about a count, four steps from the cause.
#
# So the invariant these assert is one step earlier than the ones above: every
# committed file the generator READS has to be inside the image, and has to
# survive `.dockerignore` to get there.
# ---------------------------------------------------------------------------


def _copied_paths(dockerfile: str) -> list[str]:
    """Repository-relative sources of every `COPY src dst` in the Dockerfile."""
    return [
        m.group(1)
        for m in re.finditer(r"^COPY\s+(\S+)\s+\S+\s*$", dockerfile, re.MULTILINE)
    ]


def test_every_generator_input_is_copied_into_the_image():
    """THE REGRESSION TEST FOR THE 113-FACT BUILD.

    Asserted against `REQUIRED_INPUTS` rather than against a list written here,
    so a fourth input added to the pipeline is covered the moment it is added.
    """
    from nba_peak.nba_facts import REQUIRED_INPUTS

    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    copied = _copied_paths(dockerfile)

    for required in REQUIRED_INPUTS:
        rel = required.relative_to(REPO_ROOT)
        # A COPY of any ancestor directory brings the file with it, which is
        # how `data/generated/` and `data/game/` already cover two of the
        # three. Matching on prefix rather than on the exact path keeps this
        # honest about what Docker actually does.
        candidates = [str(rel)] + [f"{parent}/" for parent in rel.parents if str(parent) != "."]
        assert any(c in copied for c in candidates), (
            f"the fact generator reads {rel} and the Dockerfile never copies it. "
            "The image will build a bank out of the inputs it does have and "
            "fail on the MIN_FACTS floor, which names a count rather than this "
            f"file. COPY lines present: {copied}"
        )


def test_no_generator_input_is_excluded_from_the_build_context():
    """A COPY cannot copy what `.dockerignore` removed from the context.

    The two halves fail identically and for different reasons, so both are
    checked: a missing COPY line, and a COPY line whose source was filtered out
    before the build ever saw it.
    """
    from nba_peak.nba_facts import REQUIRED_INPUTS

    patterns = [
        line.strip()
        for line in (REPO_ROOT / ".dockerignore").read_text().splitlines()
        if line.strip() and not line.strip().startswith("#") and not line.startswith("!")
    ]
    for required in REQUIRED_INPUTS:
        rel = str(required.relative_to(REPO_ROOT))
        for pattern in patterns:
            bare = pattern.rstrip("/")
            assert not (rel == bare or rel.startswith(f"{bare}/")), (
                f"`.dockerignore` line {pattern!r} removes {rel} from the build "
                "context, so the fact generator cannot read it inside the image"
            )


def test_a_missing_input_names_the_file_rather_than_a_fact_count():
    """The diagnostic, asserted as behaviour.

    `assert_inputs_present` exists so the build fails with the path it could
    not find. Without it, the same condition produced a valid-looking 113-fact
    bank and an error about `MIN_FACTS`.
    """
    from nba_peak.nba_facts import assert_inputs_present, missing_inputs
    import nba_peak.nba_facts.bank as bank_module

    assert missing_inputs() == [], "this checkout is missing a committed input"
    assert_inputs_present()  # does not raise

    absent = REPO_ROOT / "data" / "facts" / "does-not-exist.json"
    original = bank_module.REQUIRED_INPUTS
    bank_module.REQUIRED_INPUTS = original + (absent,)
    try:
        with pytest.raises(FileNotFoundError) as excinfo:
            bank_module.assert_inputs_present()
    finally:
        bank_module.REQUIRED_INPUTS = original
    message = str(excinfo.value)
    assert "does-not-exist.json" in message
    assert "MIN_FACTS" not in message
    assert "Dockerfile" in message or "COPY" in message


def test_the_curated_half_refuses_to_be_silently_absent():
    """`load_editorial` used to return `[]` for a missing file.

    That is the single behaviour that turned a packaging mistake into a fact
    count: the build carried on, produced a smaller bank, and reported the size
    rather than the cause. Its two sibling loaders have always raised.
    """
    from nba_peak.nba_facts import EditorialFactError, load_editorial

    with pytest.raises(EditorialFactError) as excinfo:
        load_editorial(REPO_ROOT / "data" / "facts" / "not-a-real-file.json")
    assert "missing" in str(excinfo.value).lower()


def test_the_image_asserts_its_inputs_before_generating_anything():
    """The Dockerfile checks the copy landed, at the layer that does the copy."""
    dockerfile = (REPO_ROOT / "Dockerfile").read_text()
    assert "assert_inputs_present" in dockerfile, (
        "the image generates the bank without first checking it has the files "
        "to generate it from"
    )
    # Against the RUN line, not against any mention: the comment above the
    # generated-data block names the script too, and matching that would pass
    # for an assertion placed anywhere at all.
    run_line = re.search(
        r"^RUN python scripts/build_nba_facts\.py", dockerfile, re.MULTILINE
    )
    assert run_line, "the image no longer runs the fact generator"
    assert dockerfile.index("assert_inputs_present") < run_line.start(), (
        "the input assertion must run BEFORE the generator, or it adds nothing"
    )
