import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { requireOptionalNativeModule } from "expo";
import Svg, { Path } from "react-native-svg";

import { mediaMaxHeight } from "../lib/media-frame";
import { videoPosterPath, type TimelineMoment } from "../lib/journal";
import { getSupabase, mediaUrl } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { face } from "../lib/tokens";
import { videoAspectRatio, videoSurfaceAction } from "../lib/video-playback";
import { resolveVideoSource, type VideoSource } from "../lib/video-source";
import { PrivateImage } from "./private-image";

type Playback = {
  play: () => void;
  pause: () => void;
  muted: boolean;
  currentTime: number;
  addListener?: (
    event: "statusChange",
    listener: (event: { status?: string }) => void,
  ) => { remove: () => void };
};

type FullscreenHandle = {
  enterFullscreen: () => Promise<void> | void;
};

type VideoViewProps = {
  player: Playback;
  style?: object;
  contentFit?: "contain";
  nativeControls?: boolean;
  allowsPictureInPicture?: boolean;
  playsInline?: boolean;
  onFirstFrameRender?: () => void;
  ref?: Ref<FullscreenHandle>;
};

type VideoModule = {
  useVideoPlayer: (
    source: { uri: string; headers?: Record<string, string> },
    setup?: (player: Playback) => void,
  ) => Playback;
  VideoView: (props: VideoViewProps) => ReactNode;
};

/**
 * expo-video is not in the runtime 0.3.0 binary. Importing it at startup
 * throws "Cannot find native module". Load it on the first tap and keep the
 * poster if that import fails, so an OTA to build 7 still opens the feed.
 */
let cachedModule: Promise<VideoModule | null> | null = null;

function loadVideoModule() {
  if (!cachedModule) {
    cachedModule = importVideoModule().catch(() => null);
  }
  return cachedModule;
}

function resetVideoModule() {
  cachedModule = null;
}

async function importVideoModule(): Promise<VideoModule> {
  if (Platform.OS === "web") {
    const [playerMod, viewMod] = await Promise.all([
      import("expo-video/build/VideoPlayer.web"),
      import("expo-video/build/VideoView.web"),
    ]);
    return {
      useVideoPlayer: playerMod.useVideoPlayer as VideoModule["useVideoPlayer"],
      VideoView: viewMod.VideoView as unknown as VideoModule["VideoView"],
    };
  }
  // Requiring expo-video without its native module throws inside Metro's
  // module init, which a lazy require reports to ErrorUtils as a fatal error
  // (a crash in release) instead of rejecting this promise. Probe first.
  if (!requireOptionalNativeModule("ExpoVideo")) {
    throw new Error("ExpoVideo native module is not in this binary");
  }
  const native = await import("expo-video");
  return {
    useVideoPlayer: native.useVideoPlayer as VideoModule["useVideoPlayer"],
    VideoView: native.VideoView as unknown as VideoModule["VideoView"],
  };
}

class VideoBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function PlayMark() {
  return (
    <Svg width={16} height={16} viewBox="0 0 16 16">
      <Path d="M5 3.2v9.6L13 8 5 3.2Z" fill="#fff" />
    </Svg>
  );
}

function PosterFrame({
  moment,
  label,
  headers,
  unavailable,
  onPlay,
  onRetry,
}: Readonly<{
  moment: TimelineMoment;
  label: string;
  headers?: Record<string, string> | null;
  unavailable: boolean;
  onPlay: () => void;
  onRetry: () => void;
}>) {
  const { colors } = useAppTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const ratio = videoAspectRatio(moment.posterWidth, moment.posterHeight);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Play ${label}`}
        onPress={onPlay}
        style={styles.posterHit}
      >
        {moment.hasPoster ? (
          <PrivateImage
            path={videoPosterPath(moment.id)}
            width={moment.posterWidth && moment.posterHeight ? moment.posterWidth : 16}
            height={moment.posterWidth && moment.posterHeight ? moment.posterHeight : 9}
            label={label}
            headers={headers}
            frameWidth={0}
            mat="#050b08"
          />
        ) : (
          <View
            style={[
              styles.mat,
              {
                aspectRatio: ratio,
                maxHeight: mediaMaxHeight(viewportWidth, viewportHeight),
              },
            ]}
          />
        )}
        <View style={styles.bar} pointerEvents="none">
          <PlayMark />
          <Text style={[face(colors, 400), styles.time]}>0:00</Text>
        </View>
      </Pressable>
      {unavailable ? (
        <View style={styles.unavailable}>
          <Text style={[face(colors, 400), styles.unavailableCopy, { color: colors.muted }]}>
            This video couldn’t be opened.
          </Text>
          <Text style={[face(colors, 400), styles.unavailableHint, { color: colors.muted }]}>
            iPhone clips often need Safari, or an MP4 copy.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={[styles.retry, { borderColor: colors.hairline }]}
          >
            <Text style={[face(colors, 600), { color: colors.ink, fontSize: 14 }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function PlayingClip({
  video,
  source,
  moment,
  headers,
  holding,
  muted,
  label,
  aspectRatio,
  onScreen,
  onResume,
  onMute,
  onFailed,
}: Readonly<{
  video: VideoModule;
  source: VideoSource;
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  holding: boolean;
  aspectRatio: number;
  muted: boolean;
  label: string;
  onScreen: boolean;
  onResume: () => void;
  onMute: () => void;
  onFailed: () => void;
}>) {
  const { colors } = useAppTheme();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const viewRef = useRef<FullscreenHandle>(null);
  // The poster stays over the player until AVPlayer has a frame, so a slow
  // first read shows the picture and a spinner instead of a black box.
  const [rendered, setRendered] = useState(false);
  const { useVideoPlayer, VideoView } = video;
  const playerSource = useMemo(
    () => (source.headers ? { uri: source.uri, headers: source.headers } : { uri: source.uri }),
    [source],
  );
  const player = useVideoPlayer(playerSource, (instance) => {
    instance.muted = muted;
  });

  useEffect(() => {
    if (holding) {
      player.pause();
      return;
    }
    try {
      const pending = player.play() as void | Promise<void>;
      if (pending && typeof pending.then === "function") {
        void pending.catch(() => undefined);
      }
    } catch {
      // play() can reject when the file is missing or the gesture has ended.
    }
  }, [player, holding]);

  useEffect(() => {
    const subscription = player.addListener?.("statusChange", (event) => {
      if (event.status === "error") onFailed();
    });
    return () => subscription?.remove();
  }, [player, onFailed]);

  // VideoPlayer is an external mutable handle, like HTMLVideoElement.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  /* eslint-enable react-hooks/immutability */

  const surface = videoSurfaceAction({
    started: true,
    onScreen,
    resumed: !holding,
  });

  return (
    <View
      style={[
        styles.mat,
        {
          aspectRatio,
          maxHeight: mediaMaxHeight(viewportWidth, viewportHeight),
        },
      ]}
    >
      <VideoView
        ref={viewRef}
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls={false}
        allowsPictureInPicture={false}
        playsInline
        onFirstFrameRender={() => setRendered(true)}
      />
      {rendered ? null : (
        <View style={styles.cover} pointerEvents="none">
          {moment.hasPoster ? (
            <PrivateImage
              path={videoPosterPath(moment.id)}
              width={moment.posterWidth && moment.posterHeight ? moment.posterWidth : 16}
              height={moment.posterWidth && moment.posterHeight ? moment.posterHeight : 9}
              label={label}
              headers={headers}
              frameWidth={0}
              mat="#050b08"
            />
          ) : null}
          <View style={styles.spinner}>
            <ActivityIndicator color="#fff" accessibilityLabel={`Loading ${label}`} />
          </View>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={surface === "play" ? `Play ${label}` : `Full screen, ${label}`}
        onPress={() => {
          if (surface === "play") {
            onResume();
            return;
          }
          void viewRef.current?.enterFullscreen();
        }}
        style={styles.hit}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={muted ? "Unmute" : "Mute"}
        onPress={onMute}
        style={styles.mute}
      >
        <Text style={[face(colors, 600), styles.muteLabel]}>
          {muted ? "Unmute" : "Mute"}
        </Text>
      </Pressable>
      {holding ? (
        <View style={styles.pausedMark} pointerEvents="none">
          <PlayMark />
        </View>
      ) : null}
    </View>
  );
}

export function JournalVideo({
  moment,
  label,
  headers,
  onScreen = true,
}: Readonly<{
  moment: TimelineMoment;
  label: string;
  headers?: Record<string, string> | null;
  onScreen?: boolean;
}>) {
  const [started, setStarted] = useState(false);
  const [resumed, setResumed] = useState(true);
  const [muted, setMuted] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [video, setVideo] = useState<VideoModule | null>(null);
  const [source, setSource] = useState<VideoSource | null>(null);
  const aspectRatio = videoAspectRatio(moment.posterWidth, moment.posterHeight);
  const [trackedOnScreen, setTrackedOnScreen] = useState(onScreen);
  if (onScreen !== trackedOnScreen) {
    setTrackedOnScreen(onScreen);
    if (!onScreen) setResumed(false);
  }
  const holding = started && (!onScreen || !resumed);
  const failPlayback = useCallback(() => {
    setVideo(null);
    setStarted(false);
    setUnavailable(true);
  }, []);

  useEffect(() => {
    // Warm the native module after paint. A missing ExpoVideo module rejects
    // this promise; the poster stays up until a tap reports it.
    void loadVideoModule();
  }, []);
  async function begin() {
    setUnavailable(false);
    // Sign a fresh Storage URL on every tap; a retry after an expired URL gets a new one.
    const sourcePromise = resolveVideoSource(getSupabase(), moment.id, {
      url: mediaUrl,
      headers,
    });
    let loaded = await loadVideoModule();
    if (!loaded) {
      resetVideoModule();
      loaded = await loadVideoModule();
    }
    const nextSource = await sourcePromise;
    setSource(nextSource);
    if (!loaded) {
      setVideo(null);
      setStarted(false);
      setUnavailable(true);
      return;
    }
    setVideo(loaded);
    setResumed(true);
    setStarted(true);
  }

  const poster = (
    <PosterFrame
      moment={moment}
      label={label}
      headers={headers}
      unavailable={unavailable}
      onPlay={() => {
        void begin();
      }}
      onRetry={() => {
        resetVideoModule();
        void begin();
      }}
    />
  );

  if (!started || !video || !source) return poster;

  return (
    <VideoBoundary
      onError={() => {
        resetVideoModule();
        setVideo(null);
        setStarted(false);
        setUnavailable(true);
      }}
    >
      <PlayingClip
        video={video}
        source={source}
        moment={moment}
        headers={headers}
        holding={holding}
        muted={muted}
        label={label}
        aspectRatio={aspectRatio}
        onScreen={onScreen}
        onResume={() => setResumed(true)}
        onMute={() => setMuted((current) => !current)}
        onFailed={failPlayback}
      />
    </VideoBoundary>
  );
}

const styles = StyleSheet.create({
  posterHit: {
    position: "relative",
  },
  mat: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#050b08",
  },
  video: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#050b08",
  },
  cover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "center",
    backgroundColor: "#050b08",
  },
  spinner: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  hit: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  pausedMark: {
    position: "absolute",
    left: 10,
    bottom: 10,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 36,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  time: {
    color: "#fff",
    fontSize: 12,
  },
  mute: {
    position: "absolute",
    top: 8,
    right: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  muteLabel: {
    color: "#fff",
    fontSize: 13,
  },
  unavailable: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    gap: 8,
  },
  unavailableCopy: {
    fontSize: 12,
    textAlign: "center",
  },
  unavailableHint: {
    fontSize: 12,
    textAlign: "center",
    maxWidth: 288,
  },
  retry: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
