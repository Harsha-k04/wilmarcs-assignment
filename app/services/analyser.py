from datetime import datetime, timedelta, timezone
import random
import os
from .ai_report import generate_channel_report

from .youtube_service import YouTubeService


def demo_analyse_channel(channel_url):
    """
    TEMPORARY DEMO PROVIDER.

    These are synthetic videos and statistics.
    This function does NOT fetch real YouTube data.
    Replace this provider when API access is available.
    """

    rng = random.Random(channel_url)
    now = datetime.now(timezone.utc)

    videos = []

    for index in range(10):
        views = rng.randint(1000, 50000)
        likes = int(views * rng.uniform(0.01, 0.06))
        comments = int(views * rng.uniform(0.001, 0.01))

        videos.append({
            "video_id": f"demo_video_{index + 1}",
            "title": f"Demo video {index + 1}",
            "views": views,
            "likes": likes,
            "comments": comments,
            "upload_date": (
                now - timedelta(days=index * 7)
            ).isoformat(),
            "thumbnail_url": None,
            "duration_seconds": None,
            "transcript_available": False,
            "data_source": "synthetic_demo",
        })

    for video in videos:
        video["engagement_rate"] = round(
            (video["likes"] + video["comments"])
            / video["views"] * 100,
            2,
        )

    ranked = sorted(
        videos, key=lambda video: video["views"], reverse=True
    )

    average_views = round(
        sum(video["views"] for video in videos) / len(videos)
    )

    average_engagement = round(
        sum(video["engagement_rate"] for video in videos)
        / len(videos),
        2,
    )

    return {
        "channel": {
            "input_url": channel_url,
            "name": "DEMO CHANNEL — synthetic data",
        },
        "data_source": "synthetic_demo",
        "warning": (
            "Illustrative data only. No real YouTube channel "
            "was fetched or analysed."
        ),
        "metrics": {
            "video_count": len(videos),
            "average_views": average_views,
            "average_engagement_rate": average_engagement,
            "best_video_id": ranked[0]["video_id"],
            "worst_video_id": ranked[-1]["video_id"],
        },
        "videos": videos,
    }

def analyse_channel(channel_url):

    if os.getenv("DEMO_MODE", "false").lower() == "true":
        result = demo_analyse_channel(channel_url)
    else:
        result = YouTubeService().analyse(channel_url)

    result["ai_report"] = generate_channel_report(result)
    return result