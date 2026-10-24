Admins must be able to add a video either as a link or as an uploaded file. The system needs the real video duration to calculate watch percentage, resume position and XP.

Scope of R&D

1. Video link

2. Video upload

I  am cover the following aspects in my research and development:


-video link validation and duration retrieval. (video link send in json format).

-video upload handling and duration extraction use formData to send the file to the backend.

calculate watch percentage, resume position, and XP based on the video duration.

percentage watched = (time watched / video duration) \* 100

xp = total xp \* (percentage watched / 100)

also resume position of video based on the last watched timestamp.

- for video player use video.js or any other suitable library that supports both link and uploaded video playback.
- video.js provides a way to get the current time of the video, which can be used to calculate the resume position and watch percentage.
- also protect the video link we use from unauthorized access by implementing token-based authentication or signed URLs.
- video.js supports HLS(HTTP Live Streaming) playback, so we can use it to play HLS(HTTP Live Streaming) videos as well.
- Instead of one large video URL, the video is broken into a .m3u8 index file and hundreds of tiny 2-second chunks (.ts files).

any think remaining to add in the scope of R&D?