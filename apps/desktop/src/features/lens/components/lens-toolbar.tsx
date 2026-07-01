import { Brush, Eye, EyeOff, MessageSquarePlus, X } from "lucide-react";
import { DRAW_TOOL, TEXT_TOOL } from "../lib/lens-geometry";
import type { LensAnnotations } from "../hooks/use-lens-annotations";

type LensToolbarProps = {
  lens: LensAnnotations;
  onExitLens?: () => void;
};

export function LensToolbar({ lens, onExitLens }: LensToolbarProps) {
  const { loadedNotes, isAnnotating, isAnnotationsVisible, tool } = lens;

  return (
    <div className="multi-lens-toolbar">
      <div className="multi-lens-toolbar-main">
        <h3 className="multi-lens-title">
          {loadedNotes.length > 1 ? `${loadedNotes.length} notes in lens` : "Lens view"}
        </h3>
        <p className="multi-lens-subtitle">
          {isAnnotating
            ? "Draw over content and add margin notes. Marks are saved per note."
            : "Read selected notes combined. Toggle marks visibility with Lens controls."}
        </p>
      </div>
      <div className="multi-lens-toolbar-actions">
        <button type="button" className="multi-lens-btn" onClick={lens.toggleAnnotationsVisible}>
          {isAnnotationsVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          <span>{isAnnotationsVisible ? "Hide marks" : "Show marks"}</span>
        </button>
        <button
          type="button"
          className={`multi-lens-btn ${isAnnotating ? "active" : ""}`}
          onClick={lens.toggleAnnotating}
        >
          <Brush size={14} />
          <span>{isAnnotating ? "Stop marking" : "Mark up"}</span>
        </button>
        {isAnnotating ? (
          <>
            <button
              type="button"
              className={`multi-lens-btn icon ${tool === DRAW_TOOL ? "active" : ""}`}
              onClick={() => lens.setTool(DRAW_TOOL)}
              aria-label="Draw tool"
              title="Draw tool"
            >
              <Brush size={14} />
            </button>
            <button
              type="button"
              className={`multi-lens-btn icon ${tool === TEXT_TOOL ? "active" : ""}`}
              onClick={() => lens.setTool(TEXT_TOOL)}
              aria-label="Text note tool"
              title="Text note tool"
            >
              <MessageSquarePlus size={14} />
            </button>
          </>
        ) : null}
        {onExitLens ? (
          <button
            type="button"
            className="multi-lens-btn icon"
            onClick={() => {
              lens.commitPendingDraftIfAny();
              onExitLens();
            }}
            aria-label="Close lens"
            title="Close lens"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
