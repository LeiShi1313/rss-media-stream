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

**Provider Identity Resolution**:
An evidence-backed decision that a Media Provider Identity belongs to a Media Title. Trusted cross-provider identifiers or exact title, year, and Platform Media Type evidence may resolve an identity; ambiguous evidence leaves it unresolved.
_Avoid_: Rating match, fuzzy title link

**Provider Source**:
A concrete adapter or data source that supplies metadata for exactly one media provider, such as a TMDB API client or a PTGen-backed Douban source. Provider source is provenance, fetch policy, and configuration scope; it is not identity.
_Avoid_: Provider, identity provider

**Provider Source Backend**:
An internal implementation backend used by a provider source, such as a search API, infogen API, or static JSON fallback. Backends are not user-selectable provider sources.
_Avoid_: Provider source, media provider

**Provider Source Configuration**:
A Workspace's settings for a Provider Source, including its workspace-wide enablement, credentials, and source-specific fetch options. Disabling a source makes all of its capabilities unavailable in that Workspace without deleting its preferences.
_Avoid_: Provider identity configuration

**Provider Source Capability**:
A declared kind of Provider Media Metadata that a Provider Source can supply for a Platform Media Type, such as descriptive metadata or a user rating. Capability is independent of Workspace configuration and preference.
_Avoid_: Feature flag, provider setting

**Provider Source Preference**:
A Workspace policy that selects or orders Provider Sources for one purpose within a Platform Media Type. Matching, metadata presentation, and rating presentation use independent preferences, with no per-user override.
_Avoid_: Provider identity priority

**Metadata Presentation Preference**:
A Provider Source Preference that orders Provider Sources for titles, artwork, descriptions, and other non-rating Provider Media Metadata. Presentation may fall back through that order when a source lacks usable metadata.
_Avoid_: Metadata provider, display provider

**Rating Presentation Preference**:
A Provider Source Preference that selects exactly one Provider Source used to present a Provider Rating for a Platform Media Type. A Workspace may select different sources for movies and TV series; if the selected source has no Provider Rating, no rating is presented and no fallback source is used.
_Avoid_: Rating provider, metadata presentation preference

**Provider Rating**:
A score attributed to a Media Provider and supplied by a named Provider Source as Provider Media Metadata, including its native scale and type plus an optional vote count. Its provenance identifies both the rating authority and the concrete source; ratings from different providers represent different audiences or methodologies and are not interchangeable, normalized, averaged, or directly compared. Match confidence and provider search relevance are not Provider Ratings.
_Avoid_: Rating, score, match confidence

**Media Enrichment**:
Post-parse provider work for a Parsed Release, including media identity resolution and prefetching source-specific metadata and ratings. Metadata and rating outcomes are independent; missing rating data does not invalidate a Release Match.
_Avoid_: Parsing, release matching

**Rating Backfill**:
Low-priority Media Enrichment of existing Media Titles after a Workspace changes its Rating Presentation Preference. It yields to ingestion and new-title enrichment, and historical ratings may remain absent while it progresses.
_Avoid_: Item reprocessing, blocking migration

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
