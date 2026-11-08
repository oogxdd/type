/** Reject the touch which became a pan, never the next independent tap. */
export class PressGate {
  private touch = 0;
  private cancelled = false;
  begin = (touch: number) => {
    if (touch < this.touch) return;
    this.touch = touch;
    this.cancelled = false;
  };
  cancel = (touch: number) => {
    if (touch === this.touch) this.cancelled = true;
  };
  allowed = () => !this.cancelled;
}
