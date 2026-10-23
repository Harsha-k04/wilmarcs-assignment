
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

try:
    from youtube_transcript_api import YouTubeTranscriptApi
except ImportError:  # Optional dependency; metadata analysis still works.
    YouTubeTranscriptApi = None


BASE_URL = "https://www.googleapis.com/youtube/v3"


class YouTubeAPIError(Exception):
    """A safe, readable error from the YouTube data provider."""


def parse_duration(value):
    """Convert YouTube ISO 8601 duration, e.g. PT4M13S, to seconds."""
    match = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
        value or "",
    )
    if not match:
        return None

    hours, minutes, seconds = (
        int(part or 0) for part in match.groups()
    )
    return hours * 3600 + minutes * 60 + seconds


def fetch_video_transcript(video_id):
    """Return transcript text when publicly available; otherwise return None.

    youtube-transcript-api versions expose either fetch(video_id) or an
    instance fetch method. Transcript access is best-effort and must never
    cause the entire channel analysis to fail.
    """
    if YouTubeTranscriptApi is None:
        return None
    try:
        # Current youtube-transcript-api releases expose a class-level fetch.
        transcript = YouTubeTranscriptApi().fetch(video_id)
    except TypeError:
        try:
            transcript = YouTubeTranscriptApi.fetch(video_id)
        except Exception:
            return None
    except Exception:
        try:
            transcript = YouTubeTranscriptApi.fetch(video_id)
        except Exception:
            return None
    try:
        parts = []
        for item in transcript:
            if isinstance(item, dict):
                text = item.get("text", "")
            else:
                text = getattr(item, "text", "")
            if text:
                parts.append(str(text))
        return " ".join(parts)[:12000] or None
    except Exception:
        return None


class YouTubeService:
    def __init__(self):
        self.api_key = os.getenv("YOUTUBE_API_KEY")
        if not self.api_key:
            raise YouTubeAPIError(
                "YOUTUBE_API_KEY is not configured."
            )

    def _get(self, endpoint, params):
        """Make an API request and translate common failures."""
        params = {**params, "key": self.api_key}

        try:
            response = requests.get(
                f"{BASE_URL}/{endpoint}",
                params=params,
                timeout=20,
            )
        except requests.RequestException as exc:
            raise YouTubeAPIError(
                "Could not connect to the YouTube API."
            ) from exc

        if response.status_code != 200:
            try:
                error = response.json().get("error", {})
                reason = (
                    error.get("errors", [{}])[0].get("reason")
                    or error.get("status")
                    or "unknownError"
                )
            except (ValueError, IndexError, AttributeError):
                reason = "unknownError"

            if response.status_code == 403:
                raise YouTubeAPIError(
                    "YouTube API access denied. Check API enablement, "
                    "key restrictions, quota and billing requirements. "
                    f"Reason: {reason}"
                )

            if response.status_code == 404:
                raise YouTubeAPIError(
                    "The requested YouTube resource was not found."
                )

            if response.status_code in (400, 401):
                raise YouTubeAPIError(
                    f"YouTube API rejected the request: {reason}"
                )

            raise YouTubeAPIError(
                f"YouTube API returned HTTP {response.status_code}."
            )

        try:
            return response.json()
        except ValueError as exc:
            raise YouTubeAPIError(
                "YouTube API returned invalid JSON."
            ) from exc

    def _resolve_channel(self, channel_input):
        """Resolve a channel URL, handle or channel ID."""
        value = channel_input.strip()
        channel_id = None
        handle = None
        username = None

        if value.startswith("@"):
            handle = value[1:]

        elif value.startswith("UC") and "/" not in value:
            channel_id = value

        else:
            parsed = urlparse(
                value if "://" in value else f"https://{value}"
            )
            host = parsed.netloc.lower().split(":")[0]

            if host not in (
                "youtube.com",
                "www.youtube.com",
                "m.youtube.com",
                "youtu.be",
                "www.youtu.be",
            ):
                raise YouTubeAPIError(
                    "Enter a valid YouTube channel URL or @handle."
                )

            parts = [
                part for part in parsed.path.split("/") if part
            ]

            if host.endswith("youtu.be"):
                raise YouTubeAPIError(
                    "That is a video URL. Enter the channel URL instead."
                )

            if not parts:
                raise YouTubeAPIError(
                    "The URL does not identify a channel."
                )

            if parts[0].startswith("@"):
                handle = parts[0][1:]
            elif parts[0] == "channel" and len(parts) > 1:
                channel_id = parts[1]
            elif parts[0] == "user" and len(parts) > 1:
                username = parts[1]
            else:
                raise YouTubeAPIError(
                    "Use a channel URL such as "
                    "youtube.com/@GoogleDevelopers or "
                    "youtube.com/channel/CHANNEL_ID."
                )

        params = {"part": "snippet,contentDetails,statistics"}

        if channel_id:
            params["id"] = channel_id
        elif handle:
            params["forHandle"] = handle
        elif username:
            params["forUsername"] = username

        result = self._get("channels", params)
        channels = result.get("items", [])

        if not channels:
            raise YouTubeAPIError(
                "No public channel matched the supplied input."
            )

        return channels[0]

    def analyse(self, channel_input, max_videos=20):
        """Collect real public metadata and calculate metrics."""
        channel = self._resolve_channel(channel_input)

        snippet = channel.get("snippet", {})
        content = channel.get("contentDetails", {})
        statistics = channel.get("statistics", {})

        uploads_playlist = (
            content.get("relatedPlaylists", {}).get("uploads")
        )
        if not uploads_playlist:
            raise YouTubeAPIError(
                "The channel does not expose an uploads playlist."
            )

        items = self._get(
            "playlistItems",
            {
                "part": "snippet,contentDetails",
                "playlistId": uploads_playlist,
                "maxResults": min(max(max_videos, 1), 20),
            },
        ).get("items", [])

        video_ids = [
            item.get("contentDetails", {}).get("videoId")
            for item in items
        ]
        video_ids = [video_id for video_id in video_ids if video_id]

        if not video_ids:
            raise YouTubeAPIError(
                "This channel has no accessible videos to analyse."
            )

        details = self._get(
            "videos",
            {
                "part": "snippet,contentDetails,statistics",
                "id": ",".join(video_ids),
                "maxResults": 50,
            },
        ).get("items", [])

        videos = []

        for item in details:
            video_snippet = item.get("snippet", {})
            video_stats = item.get("statistics", {})
            video_content = item.get("contentDetails", {})

            views = int(video_stats.get("viewCount", 0))
            likes = (
                int(video_stats["likeCount"])
                if "likeCount" in video_stats else None
            )
            comments = (
                int(video_stats["commentCount"])
                if "commentCount" in video_stats else None
            )

            # Use the interaction counts YouTube actually returns. If one is
            # omitted, calculate from the available count and mark as partial.
            available_interactions = [
                count for count in (likes, comments) if count is not None
            ]
            engagement_rate = None
            engagement_is_partial = False
            if views > 0 and available_interactions:
                engagement_rate = round(
                    sum(available_interactions) / views * 100, 2
                )
                engagement_is_partial = (
                    likes is None or comments is None
                )

            transcript_text = fetch_video_transcript(item["id"])
            videos.append({
                "video_id": item["id"],
                "title": video_snippet.get("title", ""),
                "description": video_snippet.get("description", ""),
                "tags": video_snippet.get("tags", []),
                "thumbnail_url": (
                    video_snippet.get("thumbnails", {})
                    .get("high", {})
                    .get("url")
                ),
                "upload_date": video_snippet.get("publishedAt"),
                "duration_seconds": parse_duration(
                    video_content.get("duration")
                ),
                "views": views,
                "likes": likes,
                "comments": comments,
                "engagement_rate": engagement_rate,
                "engagement_is_partial": engagement_is_partial,
                "transcript_text": transcript_text,
                "transcript_available": bool(transcript_text),
                "data_source": "youtube_data_api",
            })

        # API responses may omit deleted or unavailable videos.
        videos.sort(
            key=lambda video: video.get("upload_date") or "",
            reverse=True,
        )

        observed_views = [
            video["views"] for video in videos
            if video["views"] is not None
        ]
        # Use a view-weighted rate from interaction counts that are available.
        # Missing interaction fields are excluded, not treated as confirmed zero.
        engagement_videos = [
            video for video in videos
            if video.get("views") is not None
            and video["views"] > 0
            and (
                video.get("likes") is not None
                or video.get("comments") is not None
            )
        ]
        engagement_views = sum(video["views"] for video in engagement_videos)
        engagement_interactions = sum(
            (video["likes"] or 0) + (video["comments"] or 0)
            for video in engagement_videos
        )
        engagement_partial_video_count = sum(
            1 for video in engagement_videos
            if video.get("engagement_is_partial")
        )

        best = max(videos, key=lambda v: v["views"])
        worst = min(videos, key=lambda v: v["views"])

        upload_dates = []
        for video in videos:
            if video["upload_date"]:
                try:
                    upload_dates.append(
                        datetime.fromisoformat(
                            video["upload_date"].replace("Z", "+00:00")
                        )
                    )
                except ValueError:
                    pass

        intervals = [
            (upload_dates[i] - upload_dates[i + 1]).total_seconds()
            / 86400
            for i in range(len(upload_dates) - 1)
            if upload_dates[i] > upload_dates[i + 1]
        ]

        return {
            "channel": {
                "channel_id": channel["id"],
                "name": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "custom_url": snippet.get("customUrl"),
                "subscriber_count": statistics.get("subscriberCount"),
                "input_url": channel_input,
            },
            "data_source": "youtube_data_api",
            "metrics": {
                "video_count": len(videos),
                "average_views": (
                    round(sum(observed_views) / len(observed_views))
                    if observed_views else None
                ),
                "average_engagement_rate": (
                    round(engagement_interactions / engagement_views * 100, 2)
                    if engagement_views > 0 else None
                ),
                "engagement_partial_video_count": engagement_partial_video_count,
                "engagement_video_count": len(engagement_videos),
                "average_days_between_uploads": (
                    round(sum(intervals) / len(intervals), 1)
                    if intervals else None
                ),
                "best_video_id": best["video_id"],
                "worst_video_id": worst["video_id"],
            },
            "videos": videos,
            "transcript_note": (
                "Transcripts are collected on a best-effort basis when the "
                "optional youtube-transcript-api package and a public transcript "
                "are available. Hook/storytelling scores remain unavailable otherwise."
            ),
        }
