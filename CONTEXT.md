# RSS Media Stream

RSS Media Stream collects RSS releases, parses them into media releases, enriches them with provider metadata, and groups releases for browsing, trending, matching, subscriptions, and downloads.

## Language

**Parsed Release**:
A structured interpretation of one RSS item title, including the release title, media type, season or episode details, and release attributes.
_Avoid_: Parsed title, release parse

**Media Title**:
The platform's current grouping cluster for releases that appear to describe the same media work. It is not guaranteed to be globally unique for the real-world work while evidence is weak, and its title is a deterministic label chosen from provider metadata.
_Avoid_: Globally canonical title, deduplicated work

**Media Provider**:
A real-world metadata authority such as TMDB, TVDB, IMDb, or Douban that owns stable media IDs.
_Avoid_: Provider source, adapter

**Media Provider Identity**:
A stable identity for one media work according to one real-world metadata provider, independent of locale-specific metadata and fetch source. One provider identity belongs to one active media title at a time.
_Avoid_: Provider title link, provider metadata row

**Provider Source**:
A concrete adapter or data source that supplies metadata for exactly one media provider, such as a TMDB API client or a PTGen-backed Douban source. Provider source is provenance, fetch policy, and configuration scope; it is not identity.
_Avoid_: Provider, identity provider

**Provider Source Backend**:
An internal implementation backend used by a provider source, such as a search API, infogen API, or static JSON fallback. Backends are not user-selectable provider sources.
_Avoid_: Provider source, media provider

**Provider Source Configuration**:
Workspace/user settings for a provider source, including whether it is enabled and any credentials or source-specific fetch options.
_Avoid_: Provider identity configuration

**Provider Source Preference**:
A workspace/user preference that controls which provider sources are used first for matching and presentation within a platform media type.
_Avoid_: Provider identity priority

**Provider Media Metadata**:
Locale-scoped metadata supplied by a provider source for a media provider identity, including titles, title aliases, artwork, descriptions, ratings, and raw provider payload.
_Avoid_: Provider title, provider config, provider settings

**Title Evidence**:
The set of title strings used for matching and comparison, including a provider metadata title, original title, and title aliases while preserving their separate meanings.
_Avoid_: Single canonical title field

**Platform Media Type**:
A stable platform-level media category used for parsing, identity, matching, grouping, and subscriptions. Provider-specific media type labels and aliases are translated into this catalog before identity decisions.
_Avoid_: Provider raw type, localized media type

**Provider-Local Cluster**:
A media title created from one provider identity when there is not enough strong evidence to merge it with clusters from other providers.
_Avoid_: Duplicate bug, temporary canonical work

**Media Title Merge**:
An auditable decision that redirects one media title into another after stronger evidence shows both clusters represent the same real-world work.
_Avoid_: Upgrade, dedupe cleanup

**Release Match**:
The active or historical decision connecting a parsed release to provider metadata and, when matched, to a media title.
_Avoid_: Metadata enrichment, title correction

**Subscription**:
A user rule for accepting matching releases. A subscription may target release titles, provider identities, or a media title created from a selected provider metadata result; provider identity is the durable target when a provider result is selected.
_Avoid_: Media title watcher, trending follow
