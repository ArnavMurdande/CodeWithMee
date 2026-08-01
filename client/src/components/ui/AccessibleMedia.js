export function AccessibleMedia({
  captionsSrc,
  className = '',
  kind = 'video',
  poster,
  src,
  title,
  transcript,
}) {
  const media =
    kind === 'audio' ? (
      <audio aria-label={title} className={className} controls preload="metadata" src={src} />
    ) : (
      <video
        aria-label={title}
        className={className}
        controls
        playsInline
        poster={poster}
        preload="metadata"
        src={src}
      >
        {captionsSrc ? (
          <track default kind="captions" label="English captions" src={captionsSrc} srcLang="en" />
        ) : null}
      </video>
    );

  return (
    <figure className="cwm-accessible-media">
      {media}
      <figcaption>
        <span>{title}</span>
        {transcript ? (
          <details>
            <summary>Transcript</summary>
            <p>{transcript}</p>
          </details>
        ) : (
          <span className="cwm-accessible-media__notice">
            {kind === 'audio' ? 'A transcript' : 'Captions and a transcript'} are not available for
            this legacy media.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
