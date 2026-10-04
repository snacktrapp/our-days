import type { ReactNode } from "react";

const inlinePattern = /\*\*([^*]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export function renderLegalInline(
  text: string,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(inlinePattern.source, "g");
  let cursor = 0;
  let index = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] != null) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{match[1]}</strong>);
    } else {
      nodes.push(
        <a key={`${keyPrefix}-a${index}`} href={match[3]}>
          {match[2]}
        </a>,
      );
    }
    cursor = match.index + match[0].length;
    index += 1;
    match = pattern.exec(text);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparator(line: string) {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

type BlockKind = "heading" | "quote" | "list" | "table" | "paragraph";

function lineKind(line: string): BlockKind {
  if (line.startsWith("# ") || line.startsWith("## ")) return "heading";
  if (line.startsWith(">")) return "quote";
  if (line.startsWith("- ")) return "list";
  if (line.startsWith("|")) return "table";
  return "paragraph";
}

function groupLegalBlocks(source: string) {
  const blocks: Array<{ kind: BlockKind; lines: string[] }> = [];
  let canMerge = false;
  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      canMerge = false;
      continue;
    }
    const kind = lineKind(line);
    const current = blocks.at(-1);
    if (canMerge && kind !== "heading" && current && current.kind === kind) {
      current.lines.push(line);
      continue;
    }
    blocks.push({ kind, lines: [line] });
    canMerge = true;
  }
  return blocks;
}

function renderBlock(
  block: { kind: BlockKind; lines: string[] },
  index: number,
) {
  const { kind, lines } = block;

  if (kind === "heading") {
    const line = lines[0] ?? "";
    const level = line.startsWith("## ") ? 2 : 1;
    const Tag = level === 1 ? "h1" : "h2";
    return (
      <Tag key={index}>
        {renderLegalInline(line.slice(level === 1 ? 2 : 3), `h${index}`)}
      </Tag>
    );
  }

  if (kind === "quote") {
    return (
      <blockquote key={index}>
        {lines.map((line, lineIndex) => (
          <p key={`${index}-${lineIndex}`}>
            {renderLegalInline(
              line.replace(/^>\s?/, ""),
              `q${index}-${lineIndex}`,
            )}
          </p>
        ))}
      </blockquote>
    );
  }

  if (kind === "list") {
    return (
      <ul key={index}>
        {lines.map((line, lineIndex) => (
          <li key={`${index}-${lineIndex}`}>
            {renderLegalInline(line.slice(2), `l${index}-${lineIndex}`)}
          </li>
        ))}
      </ul>
    );
  }

  if (kind === "table") {
    const rows = lines.filter((line) => !isSeparator(line));
    const [header, ...body] = rows;
    if (header) {
      return (
        <div className="legal-table-wrap" key={index}>
          <table>
            <thead>
              <tr>
                {tableCells(header).map((cell, cellIndex) => (
                  <th key={cellIndex} scope="col">
                    {renderLegalInline(cell, `th${index}-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {tableCells(row).map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      {renderLegalInline(
                        cell,
                        `td${index}-${rowIndex}-${cellIndex}`,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }

  return <p key={index}>{renderLegalInline(lines.join(" "), `p${index}`)}</p>;
}

export function LegalMarkdown({ source }: { source: string }) {
  return (
    <div className="legal-copy">
      {groupLegalBlocks(source).map(renderBlock)}
    </div>
  );
}
