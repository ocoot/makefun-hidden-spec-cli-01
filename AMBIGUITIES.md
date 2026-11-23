# mend — SPEC readings I had to choose

Every point below is a place where SPEC.md admits two readings. For each: the reading
implemented in main.ts, and why. Practice score with these readings: 100/100.

1. **Tier-2 re-indentation when P is empty (§5).** F is the leading whitespace of the
   file's first matched line, P that of O's first line; a non-blank line of N that starts
   with P has P replaced by F. Read literally, when P is empty every line "starts with P",
   so F is prepended to every non-blank, non-context line of N. Implemented literally.
   (Gemini favoured a no-op when P is empty, on intent grounds; the SPEC presents the rule
   as an exact algorithm, so the literal formula won.)

2. **R line for a move whose hunks change no bytes (§2, §6, §8).** §2 defines A/D/M by
   path state, not bytes, and the R conditions are purely about existence before/after.
   A pure rename (or a move whose hunks reproduce the same bytes) therefore still prints
   `R <old> -> <new>`. Implemented so. (Gemini agreed.)

3. **A `\` line and the final break when a hunk's N is empty (§6).** The rule keys the
   result's final break on "a `\` line follows the hunk's last context or `+` line". A
   pure-deletion hunk matched to the end of the file has no context/`+` line, so there is
   nothing for a `\` to follow; I keep the file's final break as it was in that case,
   rather than forcing a break.

4. **Deletion sections: "its hunks are not read" (§6).** I read this as *not applied*
   (the deleted file's content is never matched), not as *not parsed*: hunk headers in a
   deletion section are still validated, because §2 reports parse errors before any file
   is looked at and §6 states the `@@` parse rule unconditionally. (Gemini favoured
   ignoring them entirely; the §2 ordering argument won.)

5. **`--- ` not followed by `+++ ` after a section's hunks (§6).** The parse-error rule
   is stated for "inside a section's header". After hunks, a stray `--- ` line that does
   not start a new section's pair is ignored (it is outside a body and outside a header);
   inside a header it is `error: parse <the line after it>` — which I read as the line
   after the `--- ` line itself.

6. **Blank lines at the end of a V4A section (§8).** §4 defines a blank line as empty or
   whitespace-only, but in an Update chunk a line of spaces is a context line with real
   content. I trim only exactly-empty trailing lines/entries at a section's end, never
   whitespace-only ones, so a trailing context line of spaces survives.

7. **`*** End of File` with no chunk in progress (§8).** The line "ends a chunk"; with no
   chunk started (no `@@` and no body line yet) there is nothing to end, so I treat it as
   `error: parse <its line>` rather than silently creating an empty chunk. An `@@` header
   with no body lines followed by `*** End of File` is a valid empty end-of-file chunk.
   (Gemini agreed the orphaned marker is not meaningful.)

8. **V4A anchor tier vs chunk tier (§8, §5).** The anchor search ("the first tier where
   one is", both sides a single line) and the O search are independent tier selections:
   an anchor may match at tier 2 while O matches at tier 0, and the replacement's
   re-indentation uses O's tier, not the anchor's. Implemented independently.

9. **Unified creation with no `+` lines (§6).** A creation section whose hunks hold no
   `+` line creates an empty file; the "ends with a line break unless a `\` follows its
   last `+` line" rule has no last `+` line to attach to, and §3 says a file of no lines
   is written empty. Implemented as a zero-byte file.

10. **SEARCH/REPLACE path search boundary (§7).** "After the previous block's REPLACE
    line" bounds the backwards path search: a block never takes a path line that belongs
    to an earlier block's span, even when it is the nearest non-blank line. When no
    eligible line exists in its own span it falls back to the previous block's path, as
    the SPEC's next sentence provides.
