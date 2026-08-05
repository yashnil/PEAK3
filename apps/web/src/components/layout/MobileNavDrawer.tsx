"use client";

/**
 * The small-screen navigation sheet.
 *
 * WHAT IT REPLACES. An in-flow `<div>` that pushed the page down when it
 * opened, trapped no focus, and listed five links flat — so reaching Rankings
 * meant reading past every game. It also carried `role="dialog"` without
 * `aria-modal`, focus containment or a scroll lock, which is the shape of an
 * accessibility bug rather than a dialog.
 *
 * WHY `Dialog`. W7's shared primitive already composes Portal + focus trap +
 * focus restore + body scroll lock + layer-aware Escape. Re-implementing any of
 * that here would produce a fourth divergent dialog, which is exactly what this
 * pass exists to stop. The sheet look is CSS on top (`nav.css`), not a second
 * modal implementation.
 *
 * SHAPE OF THE CONTENT. Accordion sections — Play, Daily, Rankings, Learn,
 * Account — where only the section containing the current route starts open.
 * That is what keeps Rankings on the first screen: collapsed groups are one row
 * each, so the whole map fits without scrolling past eleven games.
 *
 * TOUCH TARGETS. Every row carries an inline `minHeight` of `MIN_TAP_TARGET_PX`
 * rather than relying on a stylesheet, so the guarantee is observable in jsdom
 * and cannot be silently lost to a CSS load-order change.
 *
 * Owner: W1 (UX / Organization / Polish pass).
 */

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, RotateCcw } from "lucide-react";
import { Dialog } from "@/components/ui";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { cn } from "@/lib/utils";
import {
  accountLinks,
  isActive,
  navGroups,
  topLevelLinks,
  MIN_TAP_TARGET_PX,
  PLAY_TRIGGER_ACTIVE,
  SIGN_IN_HREF,
  type NavAvailability,
  type NavItem,
  type TopLevelNavLink,
} from "@/lib/nav-model";
import { useAuth } from "@/lib/auth-context";
import { signInHref } from "@/lib/supabase/safe-next";
import { useResumeState } from "@/lib/resume-state";

/** A row's fixed minimum height, as an inline style object. */
const TAP_TARGET_STYLE = { minHeight: `${MIN_TAP_TARGET_PX}px` } as const;

export interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  pathname: string;
  search?: string;
  availability?: NavAvailability;
  supabaseEnabled: boolean;
  signedIn: boolean;
}

type SectionId = "play" | "daily" | "rankings" | "learn" | "account";

export function MobileNavDrawer({
  open,
  onClose,
  pathname,
  search = "",
  availability,
  supabaseEnabled,
  signedIn,
}: MobileNavDrawerProps) {
  const groups = navGroups(availability);
  const resume = useResumeState(open);
  const { signOut } = useAuth();

  const daily = topLevelLinks.find((l) => l.id === "daily");
  const rankings = topLevelLinks.find((l) => l.id === "rankings");
  // "Learn" is a drawer-only grouping: Methodology and About are two top-level
  // links on desktop, but on a phone they are one section of reading material.
  // Contact joins them here rather than becoming a 5th persistent item on the
  // already-compact desktop bar (launch-polish IMPLEMENTATION_CONTRACT.md
  // §10 asks to add it while explicitly preserving that compactness) — the
  // footer link on every page already covers desktop, and a phone's Learn
  // accordion has the room for one more row without pushing Rankings down.
  const learnLinks: TopLevelNavLink[] = [
    ...topLevelLinks.filter((l) => l.id === "methodology" || l.id === "about"),
    { id: "contact", label: "Contact", href: "/contact" },
  ];

  const playActive = isActive(pathname, PLAY_TRIGGER_ACTIVE, search);
  const dailyActive = daily ? isActive(pathname, daily, search) : false;
  const learnActive = learnLinks.some((l) => isActive(pathname, l, search));
  const accountActive = accountLinks.some((l) => isActive(pathname, l, search));

  // Exactly one section is ever expanded. Everything open at once would push
  // Rankings below the fold, which is the exact complaint this drawer was
  // rebuilt to answer.
  //
  // Which one: the section you are already in, and otherwise Play. The earlier
  // `null` fallback was correct about the fold but wrong about the result — a
  // 390x844 capture of the homepage showed four collapsed rows and roughly 550px
  // of dead space, which reads as an empty menu rather than a considered one.
  // Play is both the likeliest intent and the only section large enough to fill
  // the sheet. Rankings stays in view because only one section is ever open;
  // the `mobile drawer reaches Rankings without scrolling` e2e test runs on
  // /arena/run-the-table, where Play is active, so the Play-expanded layout is
  // already the case it asserts.
  const [expanded, setExpanded] = useState<SectionId | null>(null);
  useEffect(() => {
    if (!open) return;
    setExpanded(
      dailyActive ? "daily" : learnActive ? "learn" : accountActive ? "account" : "play",
    );
  }, [open, playActive, dailyActive, learnActive, accountActive]);

  const toggle = (id: SectionId) => setExpanded((current) => (current === id ? null : id));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      label="Navigation menu"
      size="full"
      className="pk-nav-drawer"
      data-testid="mobile-nav-drawer"
    >
      <nav aria-label="Mobile navigation" className="pk-nav-drawer-inner">
        <div className="pk-nav-drawer-head">
          <span className="pk-nav-drawer-title">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="pk-nav-drawer-close"
            style={TAP_TARGET_STYLE}
            data-testid="mobile-nav-close"
          >
            Close
          </button>
        </div>

        <div className="pk-nav-drawer-theme">
          <span className="pk-nav-drawer-subtitle" id="pk-nav-drawer-theme-label">
            Theme
          </span>
          <ThemeToggle variant="menu" className="mt-1" />
        </div>

        {resume.run && (
          <Link
            href={resume.run.href}
            className="pk-nav-drawer-resume"
            style={TAP_TARGET_STYLE}
            data-testid="mobile-nav-resume"
            onClick={onClose}
          >
            <RotateCcw size={16} aria-hidden="true" />
            <span>{resume.run.label}</span>
          </Link>
        )}

        <Section
          id="play"
          label="Play"
          expanded={expanded === "play"}
          onToggle={toggle}
          active={playActive}
        >
          {/* The daily games are omitted here: they have their own section
              below, and listing the same href twice in one drawer would make
              "which one do I tap?" a question with no answer. */}
          {groups
            .filter((group) => group.id !== "daily")
            .map((group) => (
              <div key={group.id} className="pk-nav-drawer-subgroup">
                <p className="pk-nav-drawer-subtitle">{group.label}</p>
                <ul role="list">
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <DrawerLink
                        item={item}
                        pathname={pathname}
                        search={search}
                        onNavigate={onClose}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </Section>

        {daily && (
          <Section
            id="daily"
            label="Daily"
            expanded={expanded === "daily"}
            onToggle={toggle}
            active={dailyActive}
            href={daily.href}
            onNavigate={onClose}
          >
            <ul role="list">
              {groups
                .filter((group) => group.id === "daily")
                .flatMap((group) => group.items)
                .map((item) => (
                  <li key={item.id}>
                    <DrawerLink item={item} pathname={pathname} search={search} onNavigate={onClose} />
                  </li>
                ))}
            </ul>
          </Section>
        )}

        {/* Rankings is a destination, not a group: it must stay one tap away
            and must not be buried under an accordion header. */}
        {rankings && (
          <TopRow
            href={rankings.href}
            label={rankings.label}
            active={isActive(pathname, rankings, search)}
            onNavigate={onClose}
            testId="mobile-nav-rankings"
          />
        )}

        <Section
          id="learn"
          label="Learn"
          expanded={expanded === "learn"}
          onToggle={toggle}
          active={learnActive}
        >
          <ul role="list">
            {learnLinks.map((entry) => (
              <li key={entry.id}>
                <TopRow
                  href={entry.href}
                  label={entry.label}
                  active={isActive(pathname, entry, search)}
                  onNavigate={onClose}
                />
              </li>
            ))}
          </ul>
        </Section>

        {/* The Account section. `SectionId` has declared an "account" member
            since this drawer was written, but no `Section id="account"` was ever
            rendered — the drawer offered one flat row to `/profile`, so a
            phone user could not reach `/progress` or `/history` from the chrome
            and could not sign out at all. */}
        {supabaseEnabled &&
          (signedIn ? (
            <Section
              id="account"
              label="Account"
              expanded={expanded === "account"}
              onToggle={toggle}
              active={accountActive}
            >
              <ul role="list">
                {accountLinks.map((entry) => (
                  <li key={entry.id}>
                    <TopRow
                      href={entry.href}
                      label={entry.label}
                      active={isActive(pathname, entry, search)}
                      onNavigate={onClose}
                      testId={`mobile-nav-${entry.id}`}
                    />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="pk-nav-drawer-toprow w-full text-left"
                    style={TAP_TARGET_STYLE}
                    data-testid="mobile-nav-signout"
                    onClick={async () => {
                      onClose();
                      await signOut();
                    }}
                  >
                    <span>Sign out</span>
                  </button>
                </li>
              </ul>
            </Section>
          ) : (
            <TopRow
              href={signInHref(`${pathname}${search ? `?${search}` : ""}`)}
              label="Sign in"
              active={isActive(pathname, { href: SIGN_IN_HREF }, search)}
              onNavigate={onClose}
              testId="mobile-nav-account"
            />
          ))}
      </nav>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  id,
  label,
  expanded,
  onToggle,
  active,
  href,
  onNavigate,
  children,
}: {
  id: SectionId;
  label: string;
  expanded: boolean;
  onToggle: (id: SectionId) => void;
  active: boolean;
  /** When the group header is also a destination, its own link sits beside it. */
  href?: string;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  const regionId = `pk-nav-section-${id}`;
  return (
    <div className="pk-nav-drawer-section" data-expanded={expanded ? "true" : "false"}>
      <div className="pk-nav-drawer-section-head">
        {href ? (
          <Link
            href={href}
            className="pk-nav-drawer-section-link"
            style={TAP_TARGET_STYLE}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            {label}
            {active && <span className="pk-nav-current-mark">•</span>}
          </Link>
        ) : (
          <span className="pk-nav-drawer-section-link" style={TAP_TARGET_STYLE} aria-hidden="true">
            {label}
            {active && <span className="pk-nav-current-mark">•</span>}
          </span>
        )}
        <button
          type="button"
          className="pk-nav-drawer-section-toggle"
          style={TAP_TARGET_STYLE}
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
          data-testid={`mobile-nav-toggle-${id}`}
          onClick={() => onToggle(id)}
        >
          <ChevronDown size={16} aria-hidden="true" className={cn(expanded && "pk-rotated")} />
        </button>
      </div>
      <div id={regionId} className="pk-nav-drawer-section-body" hidden={!expanded}>
        {children}
      </div>
    </div>
  );
}

function DrawerLink({
  item,
  pathname,
  search,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  search: string;
  onNavigate: () => void;
}) {
  const current = isActive(pathname, item, search);
  return (
    <Link
      href={item.href}
      className="pk-nav-drawer-row"
      style={TAP_TARGET_STYLE}
      aria-current={current ? "page" : undefined}
      data-nav-item={item.id}
      onClick={onNavigate}
    >
      <span className="pk-nav-drawer-row-label">{item.label}</span>
      {/* Non-colour cue, so "you are here" survives greyscale and low vision. */}
      {current && <span className="pk-nav-current-mark">• Current</span>}
    </Link>
  );
}

function TopRow({
  href,
  label,
  active,
  onNavigate,
  testId,
}: {
  href: string;
  label: string;
  active: boolean;
  onNavigate: () => void;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      className="pk-nav-drawer-toprow"
      style={TAP_TARGET_STYLE}
      aria-current={active ? "page" : undefined}
      data-testid={testId}
      onClick={onNavigate}
    >
      <span>{label}</span>
      {active && <span className="pk-nav-current-mark">• Current</span>}
    </Link>
  );
}

export default MobileNavDrawer;
