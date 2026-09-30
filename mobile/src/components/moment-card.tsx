import { useState } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  audienceChipLabel,
  hiddenNoteCount,
  insightSourceLabel,
  mentionPieces,
  parseBibleVerse,
  shortPlaceLabel,
  visibleNotes,
  type MentionSpan,
} from "../lib/feed-format";
import {
  photoDeliveryPath,
  videoPosterPath,
  type FeedNote,
  type TimelineMoment,
} from "../lib/journal";
import { formatConversationStamp, formatRecordedMomentHeader } from "../lib/moment-time";
import { useAppTheme } from "../lib/theme";
import { dotColor, dotInk, face, momentGap, timelineInset, tracking } from "../lib/tokens";
import { CommentIcon, HeartGlyph, InsightMark, PlacePin } from "./icons";
import { PrivateImage } from "./private-image";

export function FeedMoment({
  moment,
  circleNames,
  feedCircleId,
  headers,
  viewerYear,
  viewerZone,
}: Readonly<{
  moment: TimelineMoment;
  circleNames: ReadonlyMap<string, string>;
  feedCircleId?: string | null;
  headers?: Record<string, string> | null;
  viewerYear: number;
  viewerZone: string;
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
    <View style={styles.moment}>
      <View style={styles.connection}>
        <View style={styles.connectionSide}>
          <Text
            style={[
              styles.chip,
              face(colors, 600, "record"),
              {
                color: colors.muted,
                borderColor: colors.hairline,
                letterSpacing: tracking(7, 0.02),
              },
            ]}
          >
            {chip}
          </Text>
        </View>
        <View style={styles.avatarColumn}>
          {insight ? (
            <View style={[styles.avatar, { backgroundColor: colors.ink }]}>
              <InsightMark color={colors.paper} size={18} />
            </View>
          ) : (
            <View
              style={[
                styles.avatar,
                { backgroundColor: dotColor(accent, colors) },
              ]}
            >
              <Text
                style={[
                  styles.avatarLetter,
                  face(colors, 700),
                  { color: dotInk(accent, colors) },
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
      <View style={[styles.card, { backgroundColor: colors.cream }]}>
        <CardBody moment={moment} headers={headers} frameWidth={width} />
      </View>
    </View>
  );
}

function CardBody({
  moment,
  headers,
  frameWidth,
}: Readonly<{
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  frameWidth: number;
}>) {
  if (moment.kind === "photo" || moment.kind === "video") {
    return (
      <View>
        <Media moment={moment} headers={headers} frameWidth={frameWidth} />
        <View style={styles.copy}>
          <AuthorRow moment={moment} />
          {moment.body ? (
            <MentionBody
              text={moment.body}
              mentions={moment.mentions}
              serif={false}
            />
          ) : null}
          <Conversation moment={moment} />
        </View>
      </View>
    );
  }

  if (moment.kind === "location") {
    return (
      <View style={styles.copy}>
        <AuthorRow moment={moment} />
        <PlaceTitle>
          {moment.placeName || moment.title || "A remembered place"}
        </PlaceTitle>
        {moment.body ? (
          <MentionBody text={moment.body} mentions={moment.mentions} serif />
        ) : null}
        <Conversation moment={moment} />
      </View>
    );
  }

  if (moment.kind === "milestone") {
    return <Milestone moment={moment} />;
  }

  return <Thought moment={moment} frameWidth={frameWidth} headers={headers} />;
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
  frameWidth,
  headers,
}: Readonly<{
  moment: TimelineMoment;
  frameWidth: number;
  headers?: Record<string, string> | null;
}>) {
  const { colors } = useAppTheme();
  const bible = moment.kind === "thought" ? parseBibleVerse(moment.body) : null;
  const insight = moment.kind === "insight";
  const poster =
    insight && moment.hasPoster ? videoPosterPath(moment.id) : undefined;

  return (
    <View style={styles.thought}>
      {insight ? (
        <View style={styles.authorLine}>
          <Text
            style={[
              styles.kicker,
              face(colors, 600, "record"),
              { color: colors.clay, letterSpacing: tracking(8, 0.18) },
            ]}
          >
            Insight
          </Text>
          {moment.canChange ? <Overflow /> : null}
        </View>
      ) : (
        <AuthorRow moment={moment} />
      )}
      {bible ? (
        <View style={styles.verse}>
          <Quote text={bible.verse} />
          <Text
            style={[
              styles.cite,
              face(colors, 400, "record"),
              { color: colors.muted, letterSpacing: tracking(9, 0.05) },
            ]}
          >
            {bible.reference} · World English Bible
          </Text>
        </View>
      ) : insight ? (
        <Quote
          text={moment.body}
          trailing={
            moment.title || moment.sourceUrl
              ? `${moment.title}${
                  moment.sourceUrl
                    ? ` · ${insightSourceLabel(moment.sourceUrl)}`
                    : ""
                }`
              : undefined
          }
          onTrailingPress={
            moment.sourceUrl
              ? () => {
                  if (moment.sourceUrl) void Linking.openURL(moment.sourceUrl);
                }
              : undefined
          }
        />
      ) : (
        <Quote text={moment.body} mentions={moment.mentions} />
      )}
      {poster ? (
        <View style={styles.insightClip}>
          <PrivateImage
            path={poster}
            width={moment.posterWidth}
            height={moment.posterHeight}
            label={`Clip attached to an Insight from ${moment.occurredOn}`}
            headers={headers}
            frameWidth={frameWidth - 34}
          />
        </View>
      ) : null}
      <Conversation moment={moment} />
    </View>
  );
}

function Quote({
  text,
  mentions = [],
  trailing,
  onTrailingPress,
}: Readonly<{
  text: string;
  mentions?: readonly MentionSpan[];
  trailing?: string;
  onTrailingPress?: () => void;
}>) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const cite = trailing ? (
    <Text
      style={[
        styles.cite,
        face(colors, 400, "record"),
        { color: colors.muted, letterSpacing: tracking(9, 0.05) },
      ]}
      onPress={onTrailingPress}
    >
      {trailing}
    </Text>
  ) : null;
  return (
    <View>
      <Text
        style={[styles.quote, face(colors, 400, "serif"), { color: colors.ink }]}
        numberOfLines={overflows && !expanded ? 5 : undefined}
        onTextLayout={(event) => {
          if (event.nativeEvent.lines.length > 5) setOverflows(true);
        }}
      >
        “
        {mentionPieces(text, mentions).map((piece) =>
          piece.mention ? (
            <Text key={piece.key} style={[face(colors, 600), { color: colors.action }]}>
              {piece.text}
            </Text>
          ) : (
            <Text key={piece.key}>{piece.text}</Text>
          ),
        )}
        ”{cite ? " " : null}
        {cite}
      </Text>
      {overflows ? (
        <Pressable onPress={() => setExpanded((current) => !current)}>
          <Text
            style={[
              styles.more,
              face(colors, 750, "record"),
              { color: colors.clay, letterSpacing: tracking(9, 0.14) },
            ]}
          >
            {expanded ? "See less" : "See more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MentionBody({
  text,
  mentions,
  serif,
  quoted = false,
  numberOfLines,
  onTextLayout,
}: Readonly<{
  text: string;
  mentions: readonly MentionSpan[];
  serif: boolean;
  quoted?: boolean;
  numberOfLines?: number;
  onTextLayout?: (lineCount: number) => void;
}>) {
  const { colors } = useAppTheme();
  const type = face(colors, 400, serif ? "serif" : "interface");
  const pieces = mentionPieces(text, mentions);
  return (
    <Text
      style={[
        serif ? styles.quote : styles.caption,
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

function AuthorRow({ moment }: Readonly<{ moment: TimelineMoment }>) {
  const { colors } = useAppTheme();
  const place = moment.placeName ? shortPlaceLabel(moment.placeName) : "";
  return (
    <View style={styles.authorLine}>
      <View style={styles.author}>
        <View
          style={[
            styles.authorAvatar,
            { backgroundColor: dotColor(moment.personAccent, colors) },
          ]}
        >
          <Text
            style={[
              styles.authorLetter,
              face(colors, 700),
              { color: dotInk(moment.personAccent, colors) },
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
      {moment.canChange ? <Overflow /> : null}
    </View>
  );
}

function Overflow() {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Moment options" style={styles.overflow}>
      {/* TODO(noop): moment menu. See src/lib/noop-controls.ts */}
      <Text style={[face(colors, 400), { color: colors.muted, fontSize: 18 }]}>•••</Text>
    </Pressable>
  );
}

function Media({
  moment,
  headers,
  frameWidth,
}: Readonly<{
  moment: TimelineMoment;
  headers?: Record<string, string> | null;
  frameWidth: number;
}>) {
  const { colors } = useAppTheme();
  const [index, setIndex] = useState(0);
  if (moment.kind === "video") {
    if (!moment.hasPoster) {
      return (
        <View style={[styles.videoFallback, { backgroundColor: colors.cream }]}>
          <Text style={[face(colors, 600, "record"), { color: colors.muted, fontSize: 11 }]}>
            Video
          </Text>
        </View>
      );
    }
    return (
      <PrivateImage
        path={videoPosterPath(moment.id)}
        width={moment.posterWidth}
        height={moment.posterHeight}
        label={`Video in ${moment.personName}’s journal from ${moment.occurredOn}`}
        headers={headers}
        frameWidth={frameWidth}
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

function Milestone({ moment }: Readonly<{ moment: TimelineMoment }>) {
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
          <MentionBody text={moment.body} mentions={moment.mentions} serif />
        ) : null}
      </View>
      <Conversation moment={moment} />
    </View>
  );
}

function Conversation({ moment }: Readonly<{ moment: TimelineMoment }>) {
  const { colors } = useAppTheme();
  const [showAll, setShowAll] = useState(false);
  const [openHearts, setOpenHearts] = useState<string | null>(null);
  const loved = moment.reactions.some(
    (reaction) => reaction.reactionId === "held-close" && reaction.isCurrentMember,
  );
  const names = moment.reactions.map((reaction, index) => {
    const emoji =
      reaction.reactionId === "made-me-smile"
        ? "😂 "
        : reaction.reactionId === "remember-this"
          ? "✨ "
          : "";
    const comma = index < moment.reactions.length - 1 ? "," : "";
    return `${emoji}${reaction.personName}${comma}`;
  });
  const notes = visibleNotes(moment.notes, showAll);
  const hidden = hiddenNoteCount(moment.notes.length);

  return (
    <View style={styles.conversation}>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a note"
          style={styles.actionHit}
        >
          {/* TODO(noop): comment composer. See src/lib/noop-controls.ts */}
          <CommentIcon color={colors.muted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loved ? "Undo love" : "Love"}
          style={styles.actionHit}
        >
          {/* TODO(noop): heart write. See src/lib/noop-controls.ts */}
          <HeartGlyph color={colors.clay} filled={loved} />
        </Pressable>
        <Text
          style={[styles.reactionNames, face(colors, 400), { color: colors.ink }]}
          numberOfLines={2}
        >
          {names.join(" ")}
        </Text>
      </View>
      {notes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          open={openHearts === note.id}
          onToggleHearts={() =>
            setOpenHearts((current) => (current === note.id ? null : note.id))
          }
        />
      ))}
      {hidden > 0 ? (
        <Pressable onPress={() => setShowAll((current) => !current)} style={styles.showMore}>
          <Text style={[face(colors, 700), { color: colors.action, fontSize: 9 }]}>
            {showAll ? "Show fewer notes" : `Show ${hidden} more`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NoteRow({
  note,
  open,
  onToggleHearts,
}: Readonly<{
  note: FeedNote;
  open: boolean;
  onToggleHearts: () => void;
}>) {
  const { colors } = useAppTheme();
  const stamp = formatConversationStamp(note.createdAt);
  return (
    <View style={styles.note}>
      <View style={styles.noteAuthor}>
        <Text style={[styles.noteName, face(colors, 600), { color: colors.ink }]} numberOfLines={1}>
          <Text style={{ color: dotColor(note.authorAccent, colors) }}>● </Text>
          {note.authorName}
        </Text>
        <Text style={[styles.noteWhen, face(colors, 400, "record"), { color: colors.muted }]}>
          {stamp}
        </Text>
        {note.canChange ? (
          <Text style={[face(colors, 400), { color: colors.muted, fontSize: 16 }]}>•••</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={note.heartedByViewer ? "Undo love on this comment" : "Love this comment"}
          onPress={note.heartCount > 0 ? onToggleHearts : undefined}
          style={styles.noteHeart}
        >
          <HeartGlyph color={note.heartedByViewer ? colors.clay : colors.muted} filled={note.heartedByViewer} size={15} />
          {note.heartCount > 0 ? (
            <Text style={[face(colors, 400), { color: colors.muted, fontSize: 11 }]}>
              {note.heartCount}
            </Text>
          ) : null}
        </Pressable>
      </View>
      <MentionBody text={note.body} mentions={note.mentions} serif={false} />
      {open ? (
        <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12, marginTop: 4 }]}>
          {lovedBy(note.heartNames)}
        </Text>
      ) : null}
    </View>
  );
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
    gap: 8,
  },
  thought: {
    paddingTop: 19,
    paddingHorizontal: 17,
    paddingBottom: 14,
    gap: 10,
  },
  quote: {
    fontSize: 18,
    lineHeight: 27,
    letterSpacing: -0.18,
  },
  caption: {
    fontSize: 14,
    lineHeight: 21,
  },
  cite: {
    fontSize: 9,
    lineHeight: 13,
  },
  verse: {
    gap: 12,
  },
  kicker: {
    fontSize: 8,
    lineHeight: 10,
    textTransform: "uppercase",
  },
  more: {
    fontSize: 9,
    lineHeight: 12,
    textTransform: "uppercase",
    marginTop: 6,
  },
  authorLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  },
  place: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
  },
  placeName: {
    fontSize: 11,
    flexShrink: 1,
  },
  with: {
    fontSize: 11,
    lineHeight: 15,
  },
  overflow: {
    width: 44,
    height: 44,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  placeTitle: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.4,
  },
  insightClip: {
    marginTop: 4,
  },
  videoFallback: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
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
    minWidth: 120,
    gap: 8,
  },
  conversation: {
    marginTop: 6,
    paddingBottom: 4,
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
    fontSize: 11,
    lineHeight: 16,
    paddingTop: 12,
  },
  note: {
    paddingLeft: 11,
    marginTop: 8,
    gap: 2,
  },
  noteAuthor: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingRight: 4,
  },
  noteName: {
    fontSize: 10,
    flexShrink: 1,
  },
  noteWhen: {
    fontSize: 8,
  },
  noteHeart: {
    marginLeft: "auto",
    minWidth: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
  },
  showMore: {
    minHeight: 44,
    justifyContent: "center",
  },
});
