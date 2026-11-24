import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ClickerScene, isWebGLAvailable, StageFrame } from '../scene/ClickerScene';
import { canvasToPngBlob, composeSnapshot } from '../lib/snapshot';
import { ClickerBuild } from '../types/build';
import { FallbackClicker, FallbackClickerHandle } from './FallbackClicker';

export interface ClickerStageHandle {
  pressKey: (comboStreak?: number) => void;
  releaseKey: () => void;
  triggerMilestoneBurst: (milestone: number) => void;
  resetCamera: () => void;
  captureSnapshot: () => Promise<Blob | null>;
  captureThumbnail: () => Promise<string>;
}

export type RendererMode = '3d' | '2d';

interface ClickerStageProps {
  build: ClickerBuild;
  reducedMotion: boolean;
  frame: StageFrame | null;
  onKeyDown: () => void;
  onKeyUp: () => void;
  onCameraReset?: () => void;
  onRendererChange?: (mode: RendererMode, reason?: string) => void;
}

export const ClickerStage = forwardRef<ClickerStageHandle, ClickerStageProps>(
  ({ build, reducedMotion, frame, onKeyDown, onKeyUp, onCameraReset, onRendererChange }, ref) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<ClickerScene | null>(null);
    const fallbackRef = useRef<FallbackClickerHandle | null>(null);
    const keyboardKey = useRef<string | null>(null);
    const [mode, setMode] = useState<RendererMode>(() => (isWebGLAvailable() ? '3d' : '2d'));
    const callbacksRef = useRef({ onKeyDown, onKeyUp, onCameraReset, onRendererChange });
    const buildRef = useRef(build);
    buildRef.current = build;
    const frameRef = useRef(frame);
    frameRef.current = frame;

    useEffect(() => {
      callbacksRef.current = { onKeyDown, onKeyUp, onCameraReset, onRendererChange };
    }, [onKeyDown, onKeyUp, onCameraReset, onRendererChange]);

    // Report the initial renderer once
    useEffect(() => {
      if (mode === '2d') callbacksRef.current.onRendererChange?.('2d', 'webgl-unavailable');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (mode !== '3d') return;
      const container = containerRef.current;
      if (!container) return;

      let stage: ClickerScene | null = null;
      try {
        stage = new ClickerScene(container, buildRef.current, reducedMotion, {
          onKeyDown: () => callbacksRef.current.onKeyDown(),
          onKeyUp: () => callbacksRef.current.onKeyUp(),
          onCameraReset: () => callbacksRef.current.onCameraReset?.(),
          onFatal: (reason) => {
            setMode('2d');
            callbacksRef.current.onRendererChange?.('2d', reason);
          },
        });
      } catch {
        // WebGL context creation failed late (driver blocklist, out of contexts…)
        container.querySelectorAll('canvas').forEach((c) => c.remove());
        setMode('2d');
        callbacksRef.current.onRendererChange?.('2d', 'webgl-init-failed');
        return;
      }
      sceneRef.current = stage;
      stage.setFrame(frameRef.current, true);

      return () => {
        stage?.dispose();
        sceneRef.current = null;
      };
      // Mount once per mode; updates are pushed via updateBuild / setReducedMotion / setFrame
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    useEffect(() => {
      sceneRef.current?.updateBuild(build);
    }, [build]);

    useEffect(() => {
      sceneRef.current?.setReducedMotion(reducedMotion);
    }, [reducedMotion]);

    useEffect(() => {
      sceneRef.current?.setFrame(frame, true);
    }, [frame]);

    useImperativeHandle(ref, () => ({
      pressKey: (streak = 1) => {
        sceneRef.current?.pressKey(streak);
        fallbackRef.current?.pressKey(streak);
      },
      releaseKey: () => {
        sceneRef.current?.releaseKey();
        fallbackRef.current?.releaseKey();
      },
      triggerMilestoneBurst: (m: number) => {
        sceneRef.current?.triggerMilestoneBurst(m);
        fallbackRef.current?.triggerMilestoneBurst(m);
      },
      resetCamera: () => sceneRef.current?.resetCamera(),
      captureSnapshot: async () => {
        const buildAtCapture = buildRef.current;
        const size = 1080;
        let source: HTMLCanvasElement | null = null;
        if (sceneRef.current) source = sceneRef.current.renderSquare(size);
        else if (fallbackRef.current) source = await fallbackRef.current.renderSquare(size);
        if (!source) return null;
        const composed = await composeSnapshot(source, buildAtCapture, size, true);
        return canvasToPngBlob(composed);
      },
      captureThumbnail: async () => {
        const buildAtCapture = buildRef.current;
        const size = 192;
        let source: HTMLCanvasElement | null = null;
        if (sceneRef.current) source = sceneRef.current.renderSquare(size * 2);
        else if (fallbackRef.current) source = await fallbackRef.current.renderSquare(size);
        if (!source) return '';
        const composed = await composeSnapshot(source, buildAtCapture, size, false);
        return composed.toDataURL('image/jpeg', 0.84);
      },
    }));

    const releaseKeyboardKey = () => {
      if (keyboardKey.current === null) return;
      keyboardKey.current = null;
      onKeyUp();
    };

    const keySize = frame ? Math.min(frame.w, frame.h) : 0;

    return (
      <div ref={containerRef} className="stage-canvas-host" data-testid="clicker-stage" data-renderer={mode}>
        {mode === '3d' && frame && (
          <button
            type="button"
            className="scene-key-button"
            data-testid="scene-key-button"
            aria-label="Press the clicker"
            aria-keyshortcuts="Space Enter"
            style={{ left: frame.x + (frame.w - keySize) / 2, top: frame.y, width: keySize, height: keySize }}
            onKeyDown={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              if (event.repeat || keyboardKey.current !== null) return;
              keyboardKey.current = event.key;
              onKeyDown();
            }}
            onKeyUp={(event) => {
              if (event.key !== keyboardKey.current) return;
              event.preventDefault();
              releaseKeyboardKey();
            }}
            onBlur={releaseKeyboardKey}
            onClick={() => {
              onKeyDown();
              onKeyUp();
            }}
          />
        )}
        {mode === '2d' && (
          <FallbackClicker
            ref={fallbackRef}
            build={build}
            reducedMotion={reducedMotion}
            frame={frame}
            onKeyDown={() => callbacksRef.current.onKeyDown()}
            onKeyUp={() => callbacksRef.current.onKeyUp()}
          />
        )}
      </div>
    );
  }
);

ClickerStage.displayName = 'ClickerStage';
