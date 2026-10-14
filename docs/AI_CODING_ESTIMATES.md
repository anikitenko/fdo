# Coding time estimates

The coding panel and activity popover estimate remaining **file generation**,
not final correctness or a guaranteed finish time. Planning, final validation,
and additional repairs can extend the task.

The primary display uses a median-based approximate time with a Low, Medium,
or High confidence label and the number of completed files in the current pass.
Confidence reflects sample count, comparable file types, and observed timing
consistency; it is not a calibrated probability. The wider range and estimation
basis are available under **Estimate details**. Substantially inconsistent
observations show **Timing is still unpredictable** instead of a countdown.

The estimator combines recent completed-file durations with a rolling 20-second
character-rate window. It requires at least five seconds of measured streaming
before using throughput; a buffered answer arriving in one burst uses duration
history instead. Historical response sizes provide a rough expected size for
the active file. Startup latency is included when projecting later files.

Recent observations from the current request receive extra weight. Matching
file categories (code, styles, data) and repair work are preferred when at least
three comparable observations exist. Ranges use empirical duration quantiles
with minimum uncertainty bounds; they are heuristics, not statistical confidence
intervals. File complexity and output size remain unknown in advance.

Only explicit file-completion events create samples. Retries clear character
counts while retaining elapsed time. A stalled stream or a response that exceeds
the historical size range pauses the numeric estimate rather than showing zero.

Local history uses `fdo:ai-coding-estimates:v2` in localStorage. It retains up to
40 numeric samples for each of 12 provider/model/thinking/streaming configurations,
expires samples after 30 days, and stores no prompts, source code, file paths,
or credentials. Storage failures fall back to in-memory observations. Clearing
this key resets learned estimates.
