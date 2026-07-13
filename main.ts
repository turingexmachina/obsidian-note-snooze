import { App, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile } from "obsidian";

interface NoteSnoozeSettings {
	propertyName: string;
}

const DEFAULT_SETTINGS: NoteSnoozeSettings = {
	propertyName: "hidden-until",
};

const HIDDEN_CLASS = "note-snooze-hidden";
const FILE_EXPLORER_VIEW_TYPE = "file-explorer";

/** Obsidian's built-in file-explorer view, typed loosely since fileItems is an internal (undocumented) API. */
interface FileExplorerView {
	fileItems: Record<string, { el: HTMLElement }>;
}

export default class NoteSnoozePlugin extends Plugin {
	settings!: NoteSnoozeSettings;

	// Paths currently snoozed. Kept in sync incrementally so we never need to
	// re-scan the whole vault except on load, on a property-name change, and
	// once a day at midnight (when "today" can change relative to a note's date).
	private hiddenPaths = new Set<string>();
	private midnightTimeout: number | null = null;
	private didInitialBuild = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NoteSnoozeSettingTab(this.app, this));

		this.addCommand({
			id: "refresh-snoozed-notes",
			name: "Refresh snoozed notes now",
			callback: () => this.rebuildHiddenSet(),
		});

		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.updateFile(file)));

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.hiddenPaths.delete(file.path);
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (this.hiddenPaths.delete(oldPath) && file instanceof TFile) {
					this.updateFile(file);
				}
			})
		);

		// A file-explorer leaf can appear after startup (sidebar reopened, split
		// pane, etc.); re-apply the already-known hidden set to it. This is
		// bounded by the number of snoozed notes, not the vault size.
		this.registerEvent(this.app.workspace.on("layout-change", () => this.applyHiddenSetToAllExplorers()));

		// Fires once initial vault indexing completes. On large vaults this can
		// happen after the workspace layout is ready, so it's the safe point to
		// do the one required full pass over cached (already-parsed) frontmatter.
		this.registerEvent(this.app.metadataCache.on("resolved", () => this.rebuildHiddenSet()));

		this.app.workspace.onLayoutReady(() => this.rebuildHiddenSet());
	}

	onunload() {
		if (this.midnightTimeout !== null) {
			window.clearTimeout(this.midnightTimeout);
		}
		// Un-hide immediately so notes reappear without waiting for a reload.
		for (const path of this.hiddenPaths) {
			this.applyToFile(path, false);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/** Called by the settings tab when the property name changes. */
	async onPropertyNameChanged() {
		for (const path of this.hiddenPaths) {
			this.applyToFile(path, false);
		}
		this.hiddenPaths.clear();
		this.rebuildHiddenSet();
	}

	/**
	 * Full pass over every markdown file, but only reads metadata already
	 * parsed and cached by Obsidian (no disk I/O, no file reads). Safe to call
	 * repeatedly; runs on load, after a property-name change, and once a day.
	 */
	private rebuildHiddenSet() {
		this.didInitialBuild = true;
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.updateFile(file);
		}
		this.applyHiddenSetToAllExplorers();
		this.scheduleMidnightRefresh();
	}

	private isSnoozed(file: TFile): boolean {
		const cache = this.app.metadataCache.getFileCache(file);
		const raw = cache?.frontmatter?.[this.settings.propertyName];
		if (raw === undefined || raw === null || raw === "") return false;

		const target = parseSnoozeDate(raw);
		if (!target) return false;

		return startOfDay(new Date()).getTime() < target.getTime();
	}

	/** Recomputes a single file's hidden state and patches the DOM only if it changed. */
	private updateFile(file: TAbstractFile) {
		if (!(file instanceof TFile)) return;

		const shouldHide = this.isSnoozed(file);
		const wasHidden = this.hiddenPaths.has(file.path);
		if (shouldHide === wasHidden) return;

		if (shouldHide) {
			this.hiddenPaths.add(file.path);
		} else {
			this.hiddenPaths.delete(file.path);
		}

		if (this.didInitialBuild) {
			this.applyToFile(file.path, shouldHide);
		}
	}

	/**
	 * O(open file-explorer leaves): directly toggles a class on the explorer's
	 * DOM node for this path via Obsidian's internal fileItems map, instead of
	 * querying/walking the DOM. No-ops for leaves where the item isn't
	 * rendered yet; applyHiddenSetToAllExplorers() catches those up later.
	 */
	private applyToFile(path: string, hidden: boolean) {
		for (const leaf of this.app.workspace.getLeavesOfType(FILE_EXPLORER_VIEW_TYPE)) {
			const view = leaf.view as unknown as FileExplorerView;
			const el = view?.fileItems?.[path]?.el;
			if (el) {
				el.toggleClass(HIDDEN_CLASS, hidden);
			}
		}
	}

	/** O(number of snoozed notes), never O(vault size). */
	private applyHiddenSetToAllExplorers() {
		for (const path of this.hiddenPaths) {
			this.applyToFile(path, true);
		}
	}

	/**
	 * A note's hidden state can only change on a day boundary, so a single
	 * timer per day is enough. The delay is recomputed from "now" every time
	 * (rather than using setInterval), so it self-corrects across DST shifts
	 * and system sleep instead of drifting.
	 */
	private scheduleMidnightRefresh() {
		if (this.midnightTimeout !== null) {
			window.clearTimeout(this.midnightTimeout);
		}
		const now = new Date();
		const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
		const delay = next.getTime() - now.getTime();

		this.midnightTimeout = window.setTimeout(() => {
			this.rebuildHiddenSet();
		}, delay);
	}
}

function parseSnoozeDate(raw: unknown): Date | null {
	if (raw instanceof Date) {
		return isNaN(raw.getTime()) ? null : startOfDay(raw);
	}
	if (typeof raw === "number") {
		const date = new Date(raw);
		return isNaN(date.getTime()) ? null : startOfDay(date);
	}
	if (typeof raw === "string") {
		const trimmed = raw.trim();
		if (!trimmed) return null;

		// Parse a leading YYYY-MM-DD as a local date explicitly. `new
		// Date("YYYY-MM-DD")` parses as UTC midnight, which shifts the
		// effective calendar day in negative-UTC-offset timezones.
		const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (match) {
			const [, y, m, d] = match;
			const date = new Date(Number(y), Number(m) - 1, Number(d));
			return isNaN(date.getTime()) ? null : date;
		}

		const parsed = new Date(trimmed);
		return isNaN(parsed.getTime()) ? null : startOfDay(parsed);
	}
	return null;
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

class NoteSnoozeSettingTab extends PluginSettingTab {
	plugin: NoteSnoozePlugin;

	constructor(app: App, plugin: NoteSnoozePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Hidden-until property")
			.setDesc(
				"Frontmatter property holding the date a note stays hidden from the file explorer until. " +
					"The note reappears on that date. Example: hidden-until: 2026-08-01"
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.propertyName)
					.setValue(this.plugin.settings.propertyName)
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.propertyName = trimmed || DEFAULT_SETTINGS.propertyName;
						await this.plugin.saveSettings();
						await this.plugin.onPropertyNameChanged();
					})
			);
	}
}
