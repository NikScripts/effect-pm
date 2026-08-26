/**
 * TEMPORARY — diagnosing the "composer bar not flush with the bottom"
 * report. Two guesses (position:fixed vs flex, then a resume-reflow
 * workaround) didn't fix it, so this reads the actual numbers instead of
 * guessing a third time. Remove once the real cause is found.
 *
 * @internal
 */
import * as React from "react";

type Readout = {
  readonly safeAreaTop: string;
  readonly safeAreaBottom: string;
  readonly innerHeight: number;
  readonly clientHeight: number;
  readonly visualViewportHeight: number | undefined;
  readonly visualViewportOffsetTop: number | undefined;
  readonly screenHeight: number;
  readonly screenAvailHeight: number;
  readonly devicePixelRatio: number;
  readonly navigatorStandalone: boolean | undefined;
  readonly visibilityState: string;
  readonly displayModeStandalone: boolean;
  readonly composerBarBottom: number | undefined;
  readonly composerBarTop: number | undefined;
};

const measure = (): Readout => {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.top = "0";
  probe.style.left = "0";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe);
  const safeAreaTop = computed.paddingTop;
  const safeAreaBottom = computed.paddingBottom;
  document.body.removeChild(probe);

  const composerBar = document.querySelector(".home-composer-bar");
  const composerBarRect = composerBar?.getBoundingClientRect();

  return {
    safeAreaTop,
    safeAreaBottom,
    innerHeight: window.innerHeight,
    clientHeight: document.documentElement.clientHeight,
    visualViewportHeight: window.visualViewport?.height,
    visualViewportOffsetTop: window.visualViewport?.offsetTop,
    screenHeight: window.screen.height,
    screenAvailHeight: window.screen.availHeight,
    devicePixelRatio: window.devicePixelRatio,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
    visibilityState: document.visibilityState,
    displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
    composerBarBottom: composerBarRect?.bottom,
    composerBarTop: composerBarRect?.top,
  };
};

export const DebugSafeArea = (): React.ReactElement => {
  const [readout, setReadout] = React.useState<Readout>(measure);

  React.useEffect(() => {
    const refresh = (): void => setReadout(measure());
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, []);

  return (
    <pre
      style={{
        position: "fixed",
        top: "0",
        bottom: "auto",
        left: "0",
        right: "0",
        zIndex: 999,
        margin: 0,
        padding: "0.5rem",
        fontSize: "10px",
        lineHeight: 1.4,
        background: "rgba(255,0,0,0.85)",
        color: "#fff",
        whiteSpace: "pre-wrap",
        pointerEvents: "none",
      }}
    >
      {`safe-area top=${readout.safeAreaTop} bottom=${readout.safeAreaBottom}
innerHeight=${readout.innerHeight} clientHeight=${readout.clientHeight}
visualViewport height=${readout.visualViewportHeight} offsetTop=${readout.visualViewportOffsetTop}
screen height=${readout.screenHeight} avail=${readout.screenAvailHeight} dpr=${readout.devicePixelRatio}
navigator.standalone=${String(readout.navigatorStandalone)} display-mode:standalone=${String(readout.displayModeStandalone)}
visibilityState=${readout.visibilityState}
composer bar: top=${readout.composerBarTop} bottom=${readout.composerBarBottom} (screen bottom=${readout.screenHeight})`}
    </pre>
  );
};
