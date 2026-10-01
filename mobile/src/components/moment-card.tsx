import { createContext, useContext, useEffect, useRef, useState, type Ref } from "react";
import {
  Linking,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type TextStyle,
} from "react-native";

import {
  audienceChipLabel,
  displayPlaceLabel,
  hiddenNoteCount,
  insightSourceLabel,
  mentionPieces,
  parseBibleVerse,
  visibleNotes,
  type MentionSpan,
} from "../lib/feed-format";
import { reversePlace } from "../lib/places";
import {
  photoDeliveryPath,
  type FeedNote,
  type TimelineMoment,
} from "../lib/journal";
import { formatConversationStamp, formatRecordedMomentHeader } from "../lib/moment-time";
import {
  createMomentNote,
  loadMentionCandidates,
  setMomentNoteHeart,
  setMomentReaction,
  trashMomentNote,
  updateMomentNote,
  type MentionCandidate,
} from "../lib/conversation";
import { getSupabase } from "../lib/supabase";
import { useAppTheme } from "../lib/theme";
import { dotColor, dotInk, face, momentGap, timelineInset, tracking, type ThemeColors } from "../lib/tokens";
import { CommentIcon, HeartGlyph, InsightMark, PlacePin } from "./icons";
import { MomentChangeContext, MomentOverflow } from "./moment-menu";
import { CommentSheet } from "./comment-sheet";
import { JournalVideo } from "./journal-video";
import { PrivateImage } from "./private-image";

function retroFace(colors: ThemeColors, accent: string) {
  if (colors.appearance === "retro") {
    return {
      backgroundColor: colors.action,
      borderRadius: 2,
      borderWidth: 1,
      borderColor: colors.action,
    };
  }
  return { backgroundColor: dotColor(accent, colors) };
}

function retroInk(colors: ThemeColors, accent: string) {
  return colors.appearance === "retro" ? colors.actionInk : dotInk(accent, colors);
}

export type JournalViewer = Readonly<{
  name: string;
  accent: string;
  membershipIds: readonly string[];
}>;

const emptyViewer: JournalViewer = { name: "You", accent: "slate", membershipIds: [] };
const OpenThreadContext = createContext(false);

export function FeedMoment({
  moment,
  circleNames,
  feedCircleId,
  headers,
  viewerYear,
  viewerZone,
  viewer = emptyViewer,
  onMomentChange,
  onMomentRemove,
  onScreen = true,
  openThread = false,
  highlighted = false,
}: Readonly<{
  moment: TimelineMoment;
  circleNames: ReadonlyMap<string, string>;
  feedCircleId?: string | null;
  headers?: Record<string, string> | null;
  viewerYear: number;
  viewerZone: string;
  viewer?: JournalViewer;
  onMomentChange?: (moment: TimelineMoment) => void;
  onMomentRemove?: (id: string) => void;
  onScreen?: boolean;
  openThread?: boolean;
  highlighted?: boolean;
}>) {
  const { width } = useWindowDimensions();
  const { colors } = useAppTheme();
  const chip = audienceChipLabel({
    audience: moment.audience,
    linkedCircleIds: moment.linkedCircleIds,
    circleId: moment.circleId,
    circleNames,
    feedCircleId,
  });
  const showZone =
    moment.kind !== "insight" &&
    moment.timePrecision !== "date" &&
    Boolean(moment.occurredAt && moment.occurredTimezone);
  const when = formatRecordedMomentHeader({
    occurredOn: moment.occurredOn,
    occurredAt: moment.occurredAt,
    occurredTimezone: moment.occurredTimezone,
    viewerTimeZone: showZone ? viewerZone : undefined,
    viewerYear,
  });
  const insight = moment.kind === "insight";
  const accent = moment.personAccent;

  return (
    <MomentChangeContext.Provider
      value={{
        onChange: (next) => onMomentChange?.(next),
        onRemove: (id) => onMomentRemove?.(id),
      }}
    >
    <OpenThreadContext.Provider value={openThread}>
    <View style={styles.moment}>
      <View style={styles.connection}>
        <View style={styles.connectionSide}>
          <Text
            style={[
              styles.chip,
              face(colors, colors.appearance === "retro" ? 700 : 600, "record"),
              colors.appearance === "retro" ? styles.chipRetro : null,
              {
                color: colors.appearance === "retro" ? colors.action : colors.muted,
                borderColor: colors.appearance === "retro" ? colors.action : colors.hairline,
                backgroundColor:
                  colors.appearance === "retro" ? colors.selectionFill : "transparent",
                letterSpacing: tracking(colors.appearance === "retro" ? 10 : 7, colors.appearance === "retro" ? 0.08 : 0.02),
              },
            ]}
          >
            {chip}
          </Text>
        </View>
        <View style={styles.avatarColumn}>
          {insight ? (
            <View
              style={[
                styles.avatar,
                colors.appearance === "retro"
                  ? {
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                    }
                  : { backgroundColor: "#1b2028" },
              ]}
            >
              <InsightMark
                color={colors.appearance === "retro" ? colors.action : "#edf0f5"}
                size={colors.appearance === "retro" ? 16 : 24}
              />
            </View>
          ) : (
        <View
          style={[
            styles.avatar,
            retroFace(colors, accent),
          ]}
        >
              <Text
                style={[
                  styles.avatarLetter,
                  face(colors, 700),
                  { color: retroInk(colors, accent) },
                ]}
              >
                {moment.personInitial}
              </Text>
            </View>
          )}
          <View style={[styles.connector, { backgroundColor: colors.line }]} />
        </View>
        <View style={styles.connectionSide}>
          <Text
            style={[styles.metaName, face(colors, 650), { color: colors.ink }]}
            numberOfLines={1}
          >
            {insight ? "Our Days" : moment.personName}
          </Text>
          <Text
            style={[
              styles.metaWhen,
              face(colors, 600, "record"),
              { color: colors.muted },
            ]}
            numberOfLines={1}
          >
            {when}
          </Text>
        </View>
      </View>
      <View
        style={[
          styles.card,
          { backgroundColor: colors.cream },
          highlighted ? { borderWidth: 1, borderColor: colors.action } : null,
        ]}
      >
        <CardBody
          moment={moment}
          headers={headers}
          frameWidth={width}
          viewer={viewer}
          onScreen={onScreen}
        />
      </View>
    </View>
    </OpenThreadContext.Provider>
    </MomentChangeContext.Provider>
  );
}

function CardBody({
  moment,
  headers,
  frameWidth,
  viewer,
  onScreen,
}: Readonly<{
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  frameWidth: number;
  viewer: JournalViewer;
  onScreen: boolean;
}>) {
  if (moment.kind === "photo" || moment.kind === "video") {
    return (
      <View>
        <Media
          moment={moment}
          headers={headers}
          frameWidth={frameWidth}
          onScreen={onScreen}
        />
        <View style={styles.copy}>
          <AuthorRow moment={moment} />
          {moment.body ? (
            <ClampedMention
              text={moment.body}
              mentions={moment.mentions}
              serif={false}
            />
          ) : null}
          <Conversation key={moment.id} moment={moment} viewer={viewer} />
        </View>
      </View>
    );
  }

  if (moment.kind === "location") {
    return (
      <View style={styles.copy}>
        <AuthorRow moment={moment} />
        <LocationHeading moment={moment} />
        {moment.body ? (
          <ClampedMention text={moment.body} mentions={moment.mentions} serif />
        ) : null}
        <Conversation key={moment.id} moment={moment} viewer={viewer} />
      </View>
    );
  }

  if (moment.kind === "milestone") {
    return <Milestone moment={moment} viewer={viewer} />;
  }

  return (
    <Thought moment={moment} headers={headers} viewer={viewer} onScreen={onScreen} />
  );
}

function LocationHeading({ moment }: Readonly<{ moment: TimelineMoment }>) {
  const place = useResolvedPlace(moment, false);
  return <PlaceTitle>{place || "A remembered place"}</PlaceTitle>;
}

function PlaceTitle({ children }: Readonly<{ children: string }>) {
  const { colors } = useAppTheme();
  return (
    <Text style={[styles.placeTitle, face(colors, 670), { color: colors.ink }]}>
      {children}
    </Text>
  );
}

function Thought({
  moment,
  headers,
  viewer,
  onScreen,
}: Readonly<{
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  viewer: JournalViewer;
  onScreen: boolean;
}>) {
  const { colors } = useAppTheme();
  const bible = moment.kind === "thought" ? parseBibleVerse(moment.body) : null;
  const insight = moment.kind === "insight";

  return (
    <View style={styles.thought}>
      {insight ? (
        <View style={styles.kickerRow}>
          <Text
            style={[
              styles.kicker,
              face(colors, 600, "record"),
              { color: colors.clay, letterSpacing: tracking(8, 0.18) },
            ]}
          >
            Insight
          </Text>
          <MomentOverflow moment={moment} color={colors.muted} />
        </View>
      ) : (
        <AuthorRow moment={moment} />
      )}
      {bible ? (
        <FlowCopy
          text={bible.verse}
          cite={`${bible.reference} · World English Bible`}
        />
      ) : insight ? (
        <FlowCopy
          text={moment.body}
          cite={moment.title || undefined}
          sourceLabel={
            moment.sourceUrl ? insightSourceLabel(moment.sourceUrl) : undefined
          }
          onSource={
            moment.sourceUrl
              ? () => {
                  if (moment.sourceUrl) void Linking.openURL(moment.sourceUrl);
                }
              : undefined
          }
        />
      ) : (
        <FlowCopy text={moment.body} mentions={moment.mentions} />
      )}
      {insight && moment.hasVideo ? (
        <View style={styles.insightClip}>
          <JournalVideo
            key={moment.id}
            moment={moment}
            label={`Clip attached to an Insight from ${moment.occurredOn}`}
            headers={headers}
            onScreen={onScreen}
          />
        </View>
      ) : null}
      <Conversation key={moment.id} moment={moment} viewer={viewer} />
    </View>
  );
}

const previewLines = 5;
const quoteLineHeight = 27;

/**
 * Unclamped copy is a grid with a 12px gap (`.bible-verse-copy`).
 * The source link's 44px min-height is only a hit target; it is not a
 * centered row. Clamped copy is one five-line flow, so the byline wraps
 * inline after the quote.
 */
function FlowCopy({
  text,
  mentions = [],
  cite,
  sourceLabel,
  onSource,
}: Readonly<{
  text: string;
  mentions?: readonly MentionSpan[];
  cite?: string;
  sourceLabel?: string;
  onSource?: () => void;
}>) {
  const { colors } = useAppTheme();
  const measureRef = useRef<View>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clamp = overflows && !expanded;
  useEffect(() => {
    const node = measureRef.current as unknown as HTMLElement | null;
    if (!node) return;
    const read = () => {
      const height = node.offsetHeight || node.scrollHeight || 0;
      if (height > quoteLineHeight * previewLines + 1) setOverflows(true);
    };
    read();
    const id = requestAnimationFrame(read);
    return () => cancelAnimationFrame(id);
  }, [text, cite, sourceLabel]);
  const citeStyle = [
    styles.cite,
    face(colors, 400, "record"),
    { color: colors.muted, letterSpacing: tracking(9, 0.05) },
  ];
  const linkColor =
    colors.appearance === "retro" ? colors.action : colors.muted;
  const quoteNode = () => <QuoteText text={text} mentions={mentions} />;
  const tailNode = () =>
    cite || sourceLabel ? (
      <Text style={citeStyle}>
        {cite ?? ""}
        {sourceLabel ? (
          <Text style={citeStyle}>
            {cite ? " · " : ""}
            <Text
              style={[citeStyle, styles.sourceLink, { color: linkColor }]}
              onPress={onSource}
            >
              {sourceLabel}
            </Text>
          </Text>
        ) : null}
      </Text>
    ) : null;

  return (
    <View style={styles.quoteSpace}>
      <View
        ref={measureRef}
        pointerEvents="none"
        style={styles.copyMeasure}
        onLayout={(event) => {
          if (event.nativeEvent.layout.height > quoteLineHeight * previewLines + 1) {
            setOverflows(true);
          }
        }}
      >
        {quoteNode()}
        {tailNode() ? (
          <View style={sourceLabel ? styles.overflowProbe : undefined}>{tailNode()}</View>
        ) : null}
      </View>
      {clamp ? (
        <View style={styles.clampedQuote}>
          <QuoteText
            text={text}
            mentions={mentions}
            cite={cite}
            sourceLabel={sourceLabel}
            onSource={onSource}
            lines={previewLines}
          />
        </View>
      ) : (
        <View style={styles.copyGrid}>
          {quoteNode()}
          {sourceLabel ? (
            <View style={styles.sourceLine}>{tailNode()}</View>
          ) : (
            tailNode()
          )}
        </View>
      )}
      {overflows ? (
        <SeeMore expanded={expanded} onPress={() => setExpanded((current) => !current)} />
      ) : null}
    </View>
  );
}

function QuoteText({
  text,
  mentions,
  cite,
  sourceLabel,
  onSource,
  lines,
}: Readonly<{
  text: string;
  mentions: readonly MentionSpan[];
  cite?: string;
  sourceLabel?: string;
  onSource?: () => void;
  lines?: number;
}>) {
  const { colors } = useAppTheme();
  const citeStyle = [
    styles.cite,
    face(colors, 400, "record"),
    { color: colors.muted, letterSpacing: tracking(9, 0.05) },
  ];
  const inline = lines != null;
  const pieces = mentionPieces(text, mentions);
  return (
    <Text
      style={[
        styles.quote,
        face(colors, 400, "serif"),
        { color: colors.ink, whiteSpace: "pre-line" } as unknown as TextStyle,
        lines
          ? ({
              display: "-webkit-box",
              overflow: "hidden",
              WebkitLineClamp: lines,
              WebkitBoxOrient: "vertical",
            } as unknown as TextStyle)
          : null,
      ]}
      numberOfLines={lines}
    >
      “
      {pieces.map((piece) =>
        piece.mention ? (
          <Text key={piece.key} style={[face(colors, 600), { color: colors.action }]}>
            {piece.text}
          </Text>
        ) : (
          piece.text
        ),
      )}
      ”
      {inline && cite ? <Text style={citeStyle}>{` ${cite}`}</Text> : null}
      {inline && sourceLabel ? (
        <Text style={citeStyle}>
          {" · "}
          <Text
            style={[
              citeStyle,
              styles.sourceLink,
              {
                color:
                  colors.appearance === "retro" ? colors.action : colors.muted,
              },
            ]}
            onPress={onSource}
          >
            {sourceLabel}
          </Text>
        </Text>
      ) : null}
    </Text>
  );
}

function SeeMore({
  expanded,
  onPress,
}: Readonly<{ expanded: boolean; onPress: () => void }>) {
  const { colors } = useAppTheme();
  return (
    <Pressable onPress={onPress} style={styles.moreHit}>
      <Text
        style={[
          styles.more,
          face(colors, 600, "record"),
          { color: colors.clay, letterSpacing: tracking(8, 0.18) },
        ]}
      >
        {expanded ? "See less" : "See more"}
      </Text>
    </Pressable>
  );
}

function ClampedMention(
  props: Readonly<{
    text: string;
    mentions: readonly MentionSpan[];
    serif: boolean;
    quoted?: boolean;
    compact?: boolean;
  }>,
) {
  const bodyRef = useRef<Text>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const id = requestAnimationFrame(() => {
      const node = bodyRef.current as unknown as HTMLElement | null;
      if (!node) return;
      const line = Number.parseFloat(getComputedStyle(node).lineHeight) || 21;
      if (node.scrollHeight > line * 5 + 1) setOverflows(true);
    });
    return () => cancelAnimationFrame(id);
  }, [props.text]);
  return (
    <View>
      <MentionBody
        textRef={bodyRef}
        {...props}
        numberOfLines={overflows && !expanded ? 5 : undefined}
        onLayout={(event) => {
          const line = props.compact ? 20 : props.serif ? 27 : 21;
          if (event.nativeEvent.layout.height > line * 5 + 2) setOverflows(true);
        }}
        onTextLayout={(count) => {
          if (count > 5) setOverflows(true);
        }}
      />
      {overflows ? (
        <SeeMore expanded={expanded} onPress={() => setExpanded((current) => !current)} />
      ) : null}
    </View>
  );
}

function MentionBody({
  text,
  mentions,
  serif,
  quoted = false,
  compact = false,
  numberOfLines,
  onTextLayout,
  onLayout,
  textRef,
}: Readonly<{
  text: string;
  mentions: readonly MentionSpan[];
  serif: boolean;
  quoted?: boolean;
  compact?: boolean;
  numberOfLines?: number;
  onTextLayout?: (lineCount: number) => void;
  onLayout?: (event: { nativeEvent: { layout: { height: number } } }) => void;
  textRef?: Ref<Text>;
}>) {
  const { colors } = useAppTheme();
  const type = face(colors, 400, serif ? "serif" : "interface");
  const pieces = mentionPieces(text, mentions);
  return (
    <Text
      ref={textRef}
      onLayout={onLayout}
      style={[
        serif ? styles.quote : compact ? styles.commentBody : styles.caption,
        type,
        { color: colors.ink },
      ]}
      numberOfLines={numberOfLines}
      onTextLayout={
        onTextLayout
          ? (event) => onTextLayout(event.nativeEvent.lines.length)
          : undefined
      }
    >
      {quoted ? "“" : null}
      {pieces.map((piece) =>
        piece.mention ? (
          <Text key={piece.key} style={[face(colors, 600), { color: colors.action }]}>
            {piece.text}
          </Text>
        ) : (
          <Text key={piece.key}>{piece.text}</Text>
        ),
      )}
      {quoted ? "”" : null}
    </Text>
  );
}

function useResolvedPlace(moment: TimelineMoment, short: boolean) {
  const stored = displayPlaceLabel(moment.placeName, short) || (short ? "" : displayPlaceLabel(moment.title, false));
  const [resolved, setResolved] = useState<{ id: string; label: string } | null>(null);
  const needsName = !stored && displayPlaceLabel(moment.placeName, false) === "" && Boolean(moment.placeName?.trim());
  useEffect(() => {
    if (!needsName || moment.latitude == null || moment.longitude == null) return;
    let active = true;
    void reversePlace(moment.latitude, moment.longitude).then((name) => {
      if (!active) return;
      const label = displayPlaceLabel(name, short);
      if (label) setResolved({ id: moment.id, label });
    });
    return () => {
      active = false;
    };
  }, [needsName, moment.id, moment.latitude, moment.longitude, short]);
  if (stored) return stored;
  return resolved?.id === moment.id ? resolved.label : "";
}

function AuthorRow({ moment }: Readonly<{ moment: TimelineMoment }>) {
  const { colors } = useAppTheme();
  const place = useResolvedPlace(moment, true);
  return (
    <View style={styles.authorLine}>
      <View style={styles.author}>
        <View
          style={[
            styles.authorAvatar,
            retroFace(colors, moment.personAccent),
          ]}
        >
          <Text
            style={[
              styles.authorLetter,
              face(colors, 700),
              { color: retroInk(colors, moment.personAccent) },
            ]}
          >
            {moment.personInitial}
          </Text>
        </View>
        <Text
          style={[styles.authorName, face(colors, 500), { color: colors.ink }]}
          numberOfLines={1}
        >
          {moment.personName}
        </Text>
        {place ? (
          <View style={styles.place}>
            <Text style={[face(colors, 400, "record"), { color: colors.muted, fontSize: 11 }]}>
              ·
            </Text>
            <PlacePin color={colors.muted} hole={colors.paper} />
            <Text
              style={[styles.placeName, face(colors, 400, "record"), { color: colors.muted }]}
              numberOfLines={1}
            >
              {place}
            </Text>
          </View>
        ) : null}
      </View>
      {moment.taggedPeopleLabel ? (
        <Text style={[styles.with, face(colors, 400), { color: colors.muted }]}>
          with {moment.taggedPeopleLabel}
        </Text>
      ) : null}
      <MomentOverflow moment={moment} color={colors.muted} />
    </View>
  );
}

/** globals.css `.connected-moment-menu-trigger`: “•••” at 15px, tracking -0.18em. */
function Media({
  moment,
  headers,
  frameWidth,
  onScreen,
}: Readonly<{
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  frameWidth: number;
  onScreen: boolean;
}>) {
  const [index, setIndex] = useState(0);
  if (moment.kind === "video") {
    return (
      <JournalVideo
        key={moment.id}
        moment={moment}
        headers={headers}
        onScreen={onScreen}
        label={`Video in ${moment.personName}’s journal from ${moment.occurredOn}`}
      />
    );
  }
  const photos = moment.photos.length > 0 ? moment.photos : [{ id: moment.id, sortOrder: 0 }];
  const photo = photos[Math.min(index, photos.length - 1)];
  return (
    <View>
      {photos.length > 1 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => {
            const next = Math.round(
              event.nativeEvent.contentOffset.x / Math.max(frameWidth, 1),
            );
            setIndex(next);
          }}
        >
          {photos.map((item) => (
            <View key={item.id} style={{ width: frameWidth }}>
              <PrivateImage
                path={photoDeliveryPath(moment.id, item.id)}
                width={item.width}
                height={item.height}
                label={`Photo in ${moment.personName}’s journal`}
                headers={headers}
                frameWidth={frameWidth}
              />
            </View>
          ))}
        </ScrollView>
      ) : (
        <PrivateImage
          path={photoDeliveryPath(moment.id, photo?.id)}
          width={photo?.width}
          height={photo?.height}
          label={`Photo in ${moment.personName}’s journal from ${moment.occurredOn}`}
          headers={headers}
          frameWidth={frameWidth}
        />
      )}
      {photos.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {photos.map((item, dot) => (
            <View
              key={item.id}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    dot === index ? "#fffaf0" : "rgba(255, 250, 240, 0.45)",
                },
              ]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Milestone({
  moment,
  viewer,
}: Readonly<{ moment: TimelineMoment; viewer: JournalViewer }>) {
  const { colors } = useAppTheme();
  const year = moment.occurredOn.slice(0, 4);
  return (
    <View style={styles.milestone}>
      <View
        style={[
          styles.seal,
          {
            borderColor: colors.ochre,
            backgroundColor: colors.selectionFill,
          },
        ]}
      >
        <Text style={[styles.sealMark, face(colors, 400, "serif"), { color: colors.ochre }]}>
          ✦
        </Text>
        <Text
          style={[
            styles.sealYear,
            face(colors, 750, "record"),
            { color: colors.ochre, letterSpacing: tracking(8, 0.12) },
          ]}
        >
          {year}
        </Text>
      </View>
      <View style={styles.milestoneCopy}>
        <AuthorRow moment={moment} />
        <Text style={[styles.placeTitle, face(colors, 670), { color: colors.ink }]}>
          {moment.title || "A milestone"}
        </Text>
        {moment.body ? (
          <ClampedMention text={moment.body} mentions={moment.mentions} serif />
        ) : null}
      </View>
      <Conversation key={moment.id} moment={moment} viewer={viewer} />
    </View>
  );
}

function Conversation({
  moment,
  viewer,
}: Readonly<{ moment: TimelineMoment; viewer: JournalViewer }>) {
  const { colors } = useAppTheme();
  const [showAll, setShowAll] = useState(false);
  const [openHearts, setOpenHearts] = useState<string | null>(null);
  const [notes, setNotes] = useState(moment.notes);
  const [reactions, setReactions] = useState(moment.reactions);
  const [composer, setComposer] = useState<FeedNote | "new" | null>(null);
  const [members, setMembers] = useState<readonly MentionCandidate[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loved = reactions.some(
    (reaction) => reaction.reactionId === "held-close" && reaction.isCurrentMember,
  );
  const names = reactions.map((reaction, index) => {
    const emoji =
      reaction.reactionId === "made-me-smile"
        ? "😂 "
        : reaction.reactionId === "remember-this"
          ? "✨ "
          : "";
    const comma = index < reactions.length - 1 ? "," : "";
    return `${emoji}${reaction.personName}${comma}`;
  });
  const visible = visibleNotes(notes, showAll);
  const hidden = hiddenNoteCount(notes.length);
  const mentionsOn =
    moment.audience !== "just_me" && moment.kind !== "insight";
  const openThread = useContext(OpenThreadContext);
  const [openedThread, setOpenedThread] = useState(false);
  if (openThread && !openedThread) {
    setOpenedThread(true);
    setShowAll(true);
  }

  async function toggleLove() {
    const supabase = getSupabase();
    if (!supabase || pending) return;
    const next = !loved;
    setPending(true);
    setError(null);
    const result = await setMomentReaction(supabase, {
      momentId: moment.id,
      reactionId: next ? "held-close" : null,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setReactions((current) => {
      const kept = current.filter(
        (reaction) => !(reaction.isCurrentMember && reaction.reactionId === "held-close"),
      );
      if (!next) return kept;
      return [
        ...kept,
        {
          id: `local-heart-${moment.id}`,
          personName: viewer.name,
          reactionId: "held-close",
          isCurrentMember: true,
        },
      ];
    });
  }

  async function toggleNoteHeart(note: FeedNote) {
    const supabase = getSupabase();
    if (!supabase || pending) return;
    const hearted = !note.heartedByViewer;
    setPending(true);
    setError(null);
    const result = await setMomentNoteHeart(supabase, { noteId: note.id, hearted });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotes((current) =>
      current.map((item) => {
        if (item.id !== note.id) return item;
        const names = hearted
          ? [...item.heartNames.filter((name) => name !== viewer.name), viewer.name]
          : item.heartNames.filter((name) => name !== viewer.name);
        return {
          ...item,
          heartedByViewer: hearted,
          heartNames: names,
          heartCount: names.length,
          revision: result.revision ?? item.revision,
        };
      }),
    );
  }

  async function openComposer(note: FeedNote | "new") {
    setError(null);
    setComposer(note);
    if (!mentionsOn) {
      setMembers([]);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const circles = moment.linkedCircleIds.length > 0 ? moment.linkedCircleIds : [moment.circleId];
    setMembers(await loadMentionCandidates(supabase, circles));
  }

  async function saveComment(body: string, mentions: readonly { userId: string; name: string; start: number; end: number }[]) {
    const supabase = getSupabase();
    if (!supabase) return;
    setPending(true);
    setError(null);
    if (composer && composer !== "new") {
      const result = await updateMomentNote(supabase, {
        noteId: composer.id,
        revision: composer.revision,
        body,
        mentions,
      });
      setPending(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNotes((current) =>
        current.map((item) =>
          item.id === composer.id
            ? {
                ...item,
                body,
                revision: result.revision,
                mentions: mentions.map((mention) => ({
                  userId: mention.userId,
                  start: mention.start,
                  end: mention.end,
                  name: mention.name,
                  active: true,
                })),
              }
            : item,
        ),
      );
      setComposer(null);
      return;
    }
    const result = await createMomentNote(supabase, { momentId: moment.id, body, mentions });
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotes((current) => [
      ...current,
      {
        id: result.noteId,
        authorName: viewer.name,
        authorAccent: viewer.accent,
        body,
        createdAt: new Date().toISOString(),
        heartCount: 0,
        heartedByViewer: false,
        heartNames: [],
        canChange: true,
        revision: 1,
        mentions: mentions.map((mention) => ({
          userId: mention.userId,
          start: mention.start,
          end: mention.end,
          name: mention.name,
          active: true,
        })),
      },
    ]);
    setComposer(null);
  }

  function removeComment(note: FeedNote) {
    Alert.alert("Remove this comment?", undefined, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          const supabase = getSupabase();
          if (!supabase) return;
          setPending(true);
          void trashMomentNote(supabase, { noteId: note.id, revision: note.revision }).then((result) => {
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            setNotes((current) => current.filter((item) => item.id !== note.id));
            setComposer(null);
          });
        },
      },
    ]);
  }

  const kind =
    moment.kind === "photo"
      ? "photo"
      : moment.kind === "location"
        ? "place"
        : moment.kind;

  return (
    <View style={[styles.conversation, visible.length > 0 && styles.conversationNotes]}>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a note"
          style={styles.actionHit}
          onPress={() => void openComposer("new")}
        >
          <CommentIcon color={colors.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loved ? "Undo love" : "Love"}
          accessibilityState={{ selected: loved }}
          disabled={pending}
          style={styles.actionHit}
          onPress={() => void toggleLove()}
        >
          <HeartGlyph
            color={
              colors.appearance === "retro"
                ? loved
                  ? colors.action
                  : colors.muted
                : colors.clay
            }
            filled={loved}
          />
        </Pressable>
        <Text
          style={[styles.reactionNames, face(colors, 400), { color: colors.ink }]}
          numberOfLines={2}
        >
          {names.join(" ")}
        </Text>
      </View>
      {visible.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          open={openHearts === note.id}
          onToggleHearts={() =>
            setOpenHearts((current) => (current === note.id ? null : note.id))
          }
          onHeart={() => void toggleNoteHeart(note)}
          onEdit={() => void openComposer(note)}
        />
      ))}
      {hidden > 0 ? (
        <Pressable onPress={() => setShowAll((current) => !current)} style={styles.showMore}>
          <Text style={[face(colors, 700), { color: colors.action, fontSize: 9 }]}>
            {showAll ? "Show fewer notes" : `Show ${hidden} more`}
          </Text>
        </Pressable>
      ) : null}
      {error && !composer ? (
        <Text style={[face(colors, 400), { color: colors.clay, fontSize: 12 }]}>{error}</Text>
      ) : null}
      {composer ? (
        <CommentSheet
          title={composer === "new" ? "Add comment" : "Edit comment"}
          context={commentContext(moment.personName, kind, moment.body || moment.title || "")}
          initialBody={composer === "new" ? "" : composer.body}
          initialMentions={
            composer === "new"
              ? []
              : composer.mentions.flatMap((mention) =>
                  mention.name
                    ? [{ userId: mention.userId, name: mention.name, start: mention.start, end: mention.end }]
                    : [],
                )
          }
          editing={composer !== "new"}
          members={members}
          pending={pending}
          error={error}
          onDismiss={() => {
            setComposer(null);
            setError(null);
          }}
          onSubmit={(body, mentions) => void saveComment(body, mentions)}
          onDelete={composer !== "new" ? () => removeComment(composer) : undefined}
        />
      ) : null}
    </View>
  );
}

function NoteRow({
  note,
  open,
  onToggleHearts,
  onHeart,
  onEdit,
}: Readonly<{
  note: FeedNote;
  open: boolean;
  onToggleHearts: () => void;
  onHeart: () => void;
  onEdit: () => void;
}>) {
  const { colors } = useAppTheme();
  const stamp = formatConversationStamp(note.createdAt);
  const counted = note.heartCount > 0;
  return (
    <View style={styles.note}>
      <View style={styles.noteAuthor}>
        <View style={styles.noteWho}>
          <View
            style={[
              styles.commentDot,
              colors.appearance === "retro" && styles.commentDotRetro,
              {
                backgroundColor:
                  colors.appearance === "retro"
                    ? colors.action
                    : dotColor(note.authorAccent, colors),
              },
            ]}
          />
          <Text
            style={[
              styles.noteName,
              face(colors, 600),
              {
                color: colors.ink,
                fontSize: colors.appearance === "retro" ? 11 : 10,
              },
            ]}
            numberOfLines={1}
          >
            {note.authorName}
          </Text>
        </View>
        <Text style={[styles.noteWhen, face(colors, 400, "record"), { color: colors.muted }]}>
          {stamp}
        </Text>
        {note.canChange ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit comment"
            onPress={onEdit}
            hitSlop={14}
            style={styles.noteMore}
          >
            {/* Web .inline-note-more-dots: three 2px dots in a 13x3 box. */}
            <View style={styles.noteDots}>
              {[0, 1, 2].map((dot) => (
                <View key={dot} style={[styles.noteDot, { backgroundColor: colors.muted }]} />
              ))}
            </View>
          </Pressable>
        ) : null}
        <View style={styles.noteHeart} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={note.heartedByViewer ? "Undo love on this comment" : "Love this comment"}
            accessibilityState={{ selected: note.heartedByViewer }}
            onPress={onHeart}
            style={[styles.noteHeartButton, counted && styles.noteHeartShifted]}
          >
            <HeartGlyph
              color={
                colors.appearance === "retro"
                  ? note.heartedByViewer
                    ? colors.action
                    : colors.muted
                  : note.heartedByViewer
                    ? colors.clay
                    : colors.muted
              }
              filled={note.heartedByViewer}
              size={15}
            />
          </Pressable>
          {counted ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${note.heartCount} ${note.heartCount === 1 ? "person loves" : "people love"} this comment`}
              onPress={onToggleHearts}
              style={styles.noteHeartCount}
            >
              <Text style={[styles.noteWhen, face(colors, 400, "record"), { color: colors.muted }]}>
                {note.heartCount}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.noteBody}>
        <ClampedMention text={note.body} mentions={note.mentions} serif={false} compact />
      </View>
      {open ? (
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12, marginTop: 4 }]}>
          {lovedBy(note.heartNames)}
        </Text>
      ) : null}
    </View>
  );
}

/** Web: `${personName} · ${kindLabel} · ${conciseLabel(text)}` (48 characters). */
function commentContext(person: string, kind: string, text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const label = flat.length <= 48 ? flat : `${flat.slice(0, 47).trimEnd()}…`;
  const named = kind === "thought" ? "written" : kind;
  const kindLabel = named ? `${named.charAt(0).toUpperCase()}${named.slice(1)}` : named;
  return label ? `${person} · ${kindLabel} · ${label}` : `${person} · ${kindLabel}`;
}

function lovedBy(names: readonly string[]) {
  if (names.length <= 1) return `Loved by ${names[0] ?? ""}`;
  if (names.length === 2) return `Loved by ${names[0]} and ${names[1]}`;
  const others = names.length - 2;
  return `Loved by ${names[0]}, ${names[1]} and ${others} ${others === 1 ? "other" : "others"}`;
}

const styles = StyleSheet.create({
  moment: {
    marginBottom: momentGap,
  },
  connection: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    zIndex: 2,
  },
  connectionSide: {
    flex: 1,
    minWidth: 0,
  },
  avatarColumn: {
    width: 24,
    alignItems: "center",
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 9,
  },
  connector: {
    width: 1,
    height: 10,
    marginTop: 0,
  },
  chip: {
    alignSelf: "flex-end",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 999,
    fontSize: 7,
    lineHeight: 9,
  },
  chipRetro: {
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  metaName: {
    fontSize: 10,
    lineHeight: 13,
  },
  metaWhen: {
    fontSize: 8,
    lineHeight: 11,
    marginTop: 1,
  },
  card: {
    marginHorizontal: -timelineInset,
  },
  copy: {
    paddingTop: 14,
    paddingHorizontal: 15,
    paddingBottom: 12,
  },
  thought: {
    paddingTop: 19,
    paddingHorizontal: 17,
    paddingBottom: 14,
  },
  quoteSpace: {
    marginTop: 10,
  },
  sourceLink: {
    textDecorationLine: "underline",
  },
  copyMeasure: {
    position: "absolute",
    left: 0,
    right: 0,
    opacity: 0,
    gap: 12,
  },
  copyGrid: {
    gap: 12,
  },
  // Hidden probe matches the unclamped cite's 44px hit target so See more
  // appears on the same quotes as the web. The visible byline does not.
  overflowProbe: {
    minHeight: 44,
  },
  sourceLine: {
    paddingBottom: 16,
  },
  quote: {
    fontSize: 18,
    lineHeight: 27,
    letterSpacing: -0.18,
    flexShrink: 1,
  },
  caption: {
    fontSize: 14,
    lineHeight: 21,
    flexShrink: 1,
  },
  cite: {
    fontSize: 9,
    lineHeight: 13.5,
  },
  verse: {
    gap: 12,
  },
  kicker: {
    fontSize: 8,
    lineHeight: 10,
    textTransform: "uppercase",
  },
  kickerRow: {
    position: "relative",
    width: "100%",
    minHeight: 20,
    justifyContent: "center",
    paddingRight: 28,
  },
  clampedQuote: {
    maxHeight: quoteLineHeight * previewLines,
    overflow: "hidden",
  },
  moreHit: {
    minHeight: 44,
    // -1px under the last line puts SEE MORE about 17px below the byline.
    // The label stays centered, so the video remains about 16px under SEE MORE.
    marginTop: -1,
    marginBottom: 0,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  more: {
    fontSize: 8,
    lineHeight: 10.4,
    textTransform: "uppercase",
  },
  commentBody: {
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 1,
  },
  authorLine: {
    position: "relative",
    width: "100%",
    minHeight: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 28,
    marginBottom: 8,
  },
  author: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  authorAvatar: {
    width: 20,
    height: 20,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  authorLetter: {
    fontSize: 9,
  },
  authorName: {
    fontSize: 11,
    lineHeight: 15,
    flexShrink: 1,
    minWidth: 0,
  },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  placeName: {
    fontSize: 11,
    flexShrink: 1,
    minWidth: 0,
  },
  with: {
    fontSize: 11,
    lineHeight: 15,
  },
  overflow: {
    position: "absolute",
    right: 0,
    top: "50%",
    width: 44,
    height: 44,
    marginTop: -22,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  placeTitle: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  insightClip: {
    marginTop: 0,
  },
  dots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  milestone: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  seal: {
    width: 84,
    height: 84,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sealMark: {
    fontSize: 20,
  },
  sealYear: {
    fontSize: 8,
    textTransform: "uppercase",
  },
  milestoneCopy: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    gap: 8,
  },
  conversation: {
    marginTop: 6,
  },
  conversationNotes: {
    paddingBottom: 16,
  },
  actions: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  actionHit: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  reactionNames: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    paddingTop: 12,
  },
  note: {
    position: "relative",
    paddingLeft: 11,
    marginTop: 8,
  },
  commentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  commentDotRetro: {
    borderRadius: 2,
  },
  noteAuthor: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 16,
    paddingRight: 52,
  },
  noteWho: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  noteBody: {
    marginTop: 2,
  },
  noteName: {
    fontSize: 10,
    flexShrink: 1,
    minWidth: 0,
  },
  noteWhen: {
    fontSize: 8,
  },
  noteHeart: {
    position: "absolute",
    top: "50%",
    right: 0,
    width: 52,
    height: 44,
    marginTop: -22,
  },
  noteHeartButton: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 44,
    height: 44,
    paddingRight: 6,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  noteHeartShifted: {
    right: 15,
  },
  noteHeartCount: {
    position: "absolute",
    top: 0,
    right: 6,
    width: 15,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  noteMore: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  noteDots: {
    width: 13,
    height: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
  },
  showMore: {
    minHeight: 44,
    justifyContent: "center",
  },
});
