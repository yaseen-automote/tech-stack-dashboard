# Craft Flow

Build a feature with impeccable UX and UI quality: shape the design, land the visual direction, build real production code, inspect and improve in-browser until it meets a high-end studio bar.

Before writing code, you need: PRODUCT.md loaded, register identified and the matching reference loaded, and a confirmed design direction for this task (either from `shape` or supplied by the user). PRODUCT.md is project context, not a task-specific brief.

Treat any approved visual direction (generated mock or stated reference) as a concrete contract for composition, hierarchy, density, atmosphere, signature motifs, and distinctive visual moves. Don't let mocks replace structure, copy, accessibility, or state design. But if the live result lacks the approved direction's major ingredients, the implementation is wrong.

## Step 0: Project Foundation

Before shape, before code: figure out what kind of project you're working in.

Look at the working directory. Run `ls`. Check for:

- An existing framework: `astro.config.mjs/ts`, `next.config.js/ts`, `nuxt.config.ts`, `svelte.config.js`, `vite.config.js/ts`, `package.json` with framework deps, `Cargo.toml` + Leptos/Yew, `Gemfile` + Rails. **If found, use it.** Do not start a parallel build, do not introduce a second framework, do not write to `dist/` or `build/` directly. Whatever pipeline the project has, respect it.
- An existing component library or design system: `src/components/`, `app/components/`, a `tokens.css` / `theme.ts`, an `astro.config` `integrations`. Read what's there before adding to it.
- An existing icon set: `lucide-react`, `@phosphor-icons/react`, `@iconify/*`, hand-rolled SVG sprites in `assets/icons/`. **Use what's already in the project**; don't introduce a second set.

If the directory is empty (greenfield), don't pick a framework silently. Ask the user via the AskUserQuestion tool, with sensible defaults framed by the brief:

```text
What should this be built on?
  - Astro (default for content-led brand sites, landing pages, marketing surfaces)
  - SvelteKit / Next.js / Nuxt (when the brief implies an app surface or significant interactivity)
  - Single index.html (one-shot demo, prototype, or a deliberately framework-free experiment)
```

Default: Astro for brand briefs, the project's existing framework for product briefs. Ask once; don't re-ask mid-task.

## Step 1: Shape the Design

Run {{command_prefix}}impeccable shape, passing along whatever feature description the user provided. Shape is **required** for craft; it is what produces a confirmed direction.

Present the shape output and stop. Wait for the user to confirm, override, or course-correct before writing code.

If the user already supplied a confirmed brief or ran shape separately, use it and skip this step.

When the original prompt + PRODUCT.md already answer scope, content, and visual direction with no real ambiguity, the shape output can be **compact** (3-5 bullets stating what you're building and the visual lane, ending with one or two specific questions or "confirm or override"). The full 10-section structured brief is reserved for genuinely ambiguous, multi-screen, or stakeholder-heavy tasks. Don't pad a clear brief into a long one to look thorough; equally, don't skip the pause to look efficient.

## Step 2: Load References

Based on the design brief's "Recommended References" section, consult the relevant impeccable reference files. At minimum, always consult:

- [spatial-design.md](spatial-design.md) for layout and spacing
- [typography.md](typography.md) for type hierarchy

Then add references based on the brief's needs:
- Complex interactions or forms? Consult [interaction-design.md](interaction-design.md)
- Animation or transitions? Consult [motion-design.md](motion-design.md)
- Color-heavy or themed? Consult [color-and-contrast.md](color-and-contrast.md)
- Responsive requirements? Consult [responsive-design.md](responsive-design.md)
- Heavy on copy, labels, or errors? Consult [ux-writing.md](ux-writing.md)

## Step 3: Land the Visual Direction (Capability-Gated)

Generate high-fidelity visual comps before implementation when all three are true:

- The work is net-new or visually open-ended enough that composition exploration will improve the build.
- The brief's scope is mid-fi, high-fi, or production-ready.
- The harness gives you native image generation (Codex's `image_gen`, an equivalent MCP tool). Don't ask the user to set up external APIs.

When met, this step is mandatory for both brand and product work. If image generation isn't available, skip silently. "The eventual UI is semantic/code-native/accessible" is not a reason to skip; those are implementation requirements, not exploration ones.

### What to generate

Generate **1 to 3** high-fidelity north-star comps from the confirmed brief. If shape already produced direction probes, resolve the winning lane further, not an unrelated exploration. Comps must differ in primary visual direction, not just color.

- Brand work: push visual identity, composition, and mood aggressively.
- Product work: push hierarchy, topology, density, tone, grounded in realistic product structure.
- Landing pages and long-form brand surfaces: show enough of the second fold to establish the system beyond the hero.

### Approval loop

Show the comps and ask what carries forward. Iterate until one direction is approved or the user delegates. If the user delegates, pick the strongest direction and explain it from the brief, not personal taste.

Before Step 4, summarize what to carry into code and what **not** to literalize from the mock. This is the handoff between visual exploration and semantic implementation.

### Mock fidelity inventory

Inventory the approved mock's major visible ingredients:

- Hero silhouette and dominant composition
- Signature motifs (planets, devices, portraits, charts, route lines, insets, badges, etc.)
- Nav and primary CTA treatment
- Section sequence, especially the second fold
- Image-native content the concept depends on
- Typography, density, color/material treatment, motion cues

For each, decide implementation: semantic HTML/CSS/SVG, generated asset, sourced asset, icon library, canvas/WebGL, or accepted omission. Don't substitute a different hero composition or visual driver post-approval without user sign-off.

If a photographic, architectural, product, or place-led mock becomes generic CSS scenery / decorative diagrams / bullets / copy, stop and fix it. That's a broken implementation, not a harmless interpretation.

Treat the mock as a north star, not a screenshot to trace. Don't rasterize core UI text. But if the live result lacks the mock's major ingredients, the implementation is wrong.

## Step 4: Asset Extraction (Need-Gated)

If the approved direction needs raster assets, create them before building. Do not replace required imagery with generic cards, bullets, emoji, fake metrics, decorative CSS panels, or filler copy.

Use the native asset producer (`impeccable_asset_producer` in Codex, `impeccable-asset-producer` in Claude Code) to create clean assets from the hi-fi mock and crops. If you do not have explicit permission to use agents, stop and ask:

```text
Asset production will work better as a scoped subagent job. Should I spawn the Impeccable asset producer subagent for this step?
```

Do not skip asset production or silently do it inline. Inline asset production is allowed only if the user declines subagents, the harness cannot spawn the authorized agent, or the user explicitly asks for single-thread mode.

Pass the approved mock, crop/contact-sheet paths, output directory, dimensions/formats, transparency needs, constraints, and avoid list to the asset producer. Attach image generation capability to the spawned agent when the harness supports it; do not load image-generation reference material into the parent thread first.

Prefer HTML/CSS/SVG/canvas when they can credibly reproduce an ingredient; use real/generated/stock imagery when the mock or subject matter calls for actual visual content.

## Step 5: Build to Production Quality

Implement the feature following the design brief. Build in passes so structure, visual system, states, motion/media, and responsive behavior each get deliberate attention. The list below is the definition of done, not inspiration.

### Production bar

- **Real content.** No placeholder copy, placeholder images, dead links, fake controls, or unused scaffold at presentation time.
- **Preserve the approved mock's major ingredients.** Missing hero objects, world/product imagery, section structure, CTA/nav treatment, or distinctive motifs are blocking defects unless the user accepted the change.
- **Semantic first.** Real headings, landmarks, labels, form associations, button/link semantics, accessible names, state announcements where needed.
- **Deliberate spacing and alignment.** No default gaps, arbitrary margins, unbalanced whitespace, or accidental optical misalignment.
- **Intentional typography.** Chosen loading strategy, clear hierarchy, readable measure, stable line breaks, no overflow at any width.
- **Realistic state coverage.** Default, hover, focus-visible, active, disabled, loading, error, success, empty, overflow, long/short text, first-run.
- **Finished interaction quality.** Keyboard paths, touch targets, feedback timing, scroll behavior, state transitions, no hover-only functionality.
- **Coherent icon set.** Use the project's established set; otherwise pick one library or use accessible text. Don't mix.
- **Respect the build pipeline.** Edit source files and run the project's build (`npm run build` or equivalent). Don't write to `build/` / `dist/` / `.next/` with `cat`, heredoc, or Bash redirects; that skips asset hashing, image optimization, code splitting, and CSS extraction, and produces output the dev server won't serve.
- **Verify image URLs before referencing them.** Use image-search MCP or web-fetch when available; guessed photo IDs ship as broken-image placeholders. Without verification, prefer fewer images you're confident about.
- **Optimized imagery and media.** Correct dimensions, useful alt text, lazy loading below the fold, modern formats when practical, responsive `srcset`/`picture` for raster, no project-referenced asset left outside the workspace.
- **Premium motion.** Use atmospheric blur, filter, mask, shadow, reveal when they improve the experience. Avoid casual layout-property animation, bound expensive effects, verify smoothness in-browser, respect reduced motion, and avoid choreography that blocks task completion.
- **Maintainable.** Reusable local patterns, clear component boundaries, project conventions. No rasterized UI text or one-off hacks when a local pattern exists.
- **Technically clean.** Production build passes, no console errors, no avoidable layout shift, no needless dependencies, no broken asset paths.
- **Ask when uncertain.** If a discovery materially changes the brief or approved direction, stop and ask. Don't guess.

## Step 6: Iterate Visually

Look at what you built like a designer would. Your eyes are whatever the harness gives you: a connected browser, a screenshotting tool, Playwright, or asking the user. Use them for responsive testing (mobile, tablet, desktop minimum) and general visual validation.

If your tool returns a file path, read the PNG back into the conversation. A screenshot you didn't read doesn't count.

For long-form brand surfaces, inspect major sections individually. Thumbnails hide spacing, clipping, and cascade defects.

After the first pass, write an honest critique against the brief, the approved mock's major ingredients (hero silhouette, motifs, imagery, nav/CTA, density), and impeccable's DON'Ts. Patch material defects and re-inspect. **Don't invent defects to demonstrate iteration.** A confident "first pass clean, shipping" beats a fake fix.

Actively check: responsive behavior (composes, not shrinks), every state (empty / error / loading / edge), craft details (spacing, alignment, hierarchy, contrast, motion timing, focus), performance basics. The exit bar: defensible in a high-end studio review.

Detector or QA output is defect evidence only; never proof the work is finished.

## Step 7: Present

Present the result to the user:
- Show the feature in its primary state
- Summarize the browser/viewports checked and the most important fixes made after inspection
- Walk through the key states (empty, error, responsive)
- Explain design decisions that connect back to the design brief and, when used, the chosen north-star mock. Include any accepted deviations from the mock; do not hide unimplemented mock ingredients.
- Note any remaining limitations or follow-up risks honestly
- Ask: "What's working? What isn't?"
