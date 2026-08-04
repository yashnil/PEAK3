"use client";

import { useRef } from "react";
import { Dialog } from "@/components/ui/Dialog";
import {
  DailyGridArchive,
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
} from "@/types/daily-grid";
import CompletionPanel from "./CompletionPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  board: DailyGridBoard;
  progress: DailyGridProgress;
  result: GridResultResponse | null;
  resultError: string | null;
  archive: DailyGridArchive | null;
  isArchiveBoard: boolean;
  officialSaved: boolean;
}

/**
 * The completion recap, launch-polish §4. Previously `CompletionPanel`
 * rendered inline, permanently claiming half the game's width in the
 * `lg:grid-cols-[1.05fr_1fr]` workbench column -- including for players who
 * had not even opened the search panel yet. Now it is the CONTENT of an
 * overlay: the board stays full-width and centred underneath at all times,
 * and this only covers it while `open`.
 *
 * `Dialog` supplies the focus trap, the body-scroll lock, Escape-to-close,
 * backdrop-click-to-close, the layer stack and reduced-motion handling --
 * see its own docstring. `size="lg"` (44rem) keeps the recap comfortably
 * readable without becoming a full-bleed sheet on desktop; on a narrow
 * viewport `Dialog`'s own responsive padding already reads as close to a
 * full-screen sheet, which is what the contract asks for on mobile -- there
 * is no separate bottom-sheet component anywhere else in this app either
 * (`HowToPlay` reuses the exact same `Dialog` the exact same way), so
 * introducing one just for this surface would be new, untested UI infra for
 * a difference `Dialog` already approximates.
 */
export default function CompletionModal({
  open,
  onClose,
  board,
  progress,
  result,
  resultError,
  archive,
  isArchiveBoard,
  officialSaved,
}: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      labelledBy="daily-grid-complete-heading"
      initialFocusRef={closeButtonRef}
      data-testid="daily-grid-complete-modal"
      className="p-4 sm:p-6"
    >
      <CompletionPanel
        board={board}
        progress={progress}
        result={result}
        resultError={resultError}
        archive={archive}
        isArchiveBoard={isArchiveBoard}
        officialSaved={officialSaved}
        onClose={onClose}
        closeButtonRef={closeButtonRef}
      />
    </Dialog>
  );
}
