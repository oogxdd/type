import { useEffect, useState } from "react";

type KeyboardInsetState = {
  keyboardInset: number;
  isKeyboardOpen: boolean;
};

export function useKeyboardInsets(): KeyboardInsetState {
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      const visualViewport = window.visualViewport;
      if (!visualViewport) {
        setKeyboardInset(0);
        return;
      }
      const overlap = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
      setKeyboardInset(Math.max(0, Math.round(overlap)));
    };

    update();

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", update);
      window.visualViewport.addEventListener("scroll", update);
    }
    window.addEventListener("resize", update);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", update);
        window.visualViewport.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
    };
  }, []);

  return {
    keyboardInset,
    isKeyboardOpen: keyboardInset > 0,
  };
}
