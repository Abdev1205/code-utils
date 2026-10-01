# The Shape of a Voice

**Topic:** Signal processing
**Covers:** Sound, pitch, the YIN algorithm, reject-option classification
**Source:** [Claude artifact](https://claude.ai/artifact/29kRCKZiXDTszXuvf1vgwU) — written by a colleague, mirrored here for study.

signal processing · F0 estimation · classification with abstention

From "what is a sound wave" to a working pitch detector — the YIN algorithm derived step by step, and the reject-option band that turns a fuzzy number into an honest classifier.

#### The CV line this explains

*"Implemented pitch-based caller gender identification with YIN fundamental-frequency estimation and a reject-option band, robust on telephony audio, surfacing the result to flows as a prompt variable driving persona and salutation."*

Every technical term in that sentence gets a section. It's a dense line and an interviewer will pull on it — **"why YIN?"**, **"what's a reject option?"** and **"why is telephony audio hard?"** are all fair questions with good answers.

## What sound is

#### Definition

**Sound** is a pressure wave travelling through air. Something vibrates, air molecules bunch up and spread out, and the pattern propagates. Your eardrum moves in response, and that movement is what you hear.

A microphone does the same thing: a membrane moves, and that movement becomes a voltage. **Audio is just a number that changes over time** — everything else in this document is arithmetic on that number.

#### Three properties, and their perceptual names

| Physical | Perceived as | Measured in |
|---|---|---|
| **Amplitude** — how far the pressure swings | Loudness | dB |
| **Frequency** — how many cycles per second | Pitch | Hz |
| **Waveform shape** | Timbre — why a violin and a flute differ at the same pitch | — |

Keep the distinction between the physical and perceived columns. It matters later: *frequency* is a measurable property of a signal, *pitch* is what a listener perceives, and they can disagree.

#### How a voice makes sound

Two stages, and the split is the key to everything here.

**1 · The source.** Air from the lungs passes through the vocal folds, which open and close rapidly. Each closure is a pulse. The rate of those pulses is your **fundamental frequency** — around 120 Hz means the folds are closing 120 times a second.

**2 · The filter.** That buzz then travels through the throat, mouth and nose, which resonate and shape it. Move your tongue and you change which frequencies are amplified — that's how you make different vowels from the same buzz.

```
vocal folds  →  buzz at F0  →  vocal tract  →  speech
   (source)      the pitch       (filter)     the words
```

This is the **source-filter model**, and its usefulness is that the two are largely independent. You can say any vowel at any pitch. Which means **F0 carries speaker information while the filter carries linguistic information** — and that's exactly why pitch is a reasonable place to look for speaker attributes.

## Making it digital

#### Sampling and quantisation

A computer can't store a continuous wave. It measures the amplitude at regular intervals and stores each measurement as a number.

```
continuous:   ╭─╮   ╭─╮   ╭─╮
             ╱   ╲ ╱   ╲ ╱   ╲
sampled:     • • • • • • • • • •     ← measure at fixed intervals
stored:      [12, 340, 891, 402, -155, ...]
```

**Sample rate**
Measurements per second. 8,000 Hz for telephony, 16,000 for most ASR, 44,100 for CDs.

**Bit depth**
How precisely each measurement is stored. 16-bit gives 65,536 levels.

**PCM**
Pulse Code Modulation — the raw format. Just the numbers, no compression.

#### What the code does with this

`_to_mono_float` in `gender_from_pitch.py` handles the conversion:

```python
ints = np.frombuffer(audio, dtype=np.int16)     # decode PCM bytes
samples = ints.astype(np.float32) / 32767.0     # normalise to ~[-1, 1]
samples = samples - float(np.mean(samples))     # remove DC offset
```

The last line matters and its comment says why: *"Remove DC offset; it biases the YIN difference function."*

**DC offset** is a constant added to every sample — the whole waveform sitting above or below zero instead of centred. Cheap hardware and some codecs introduce it. It carries no sound at all, but it does add a constant to every difference calculation, which skews the pitch estimate. One subtraction removes it.

## Nyquist

#### The single most important fact in digital audio

**A sample rate of N Hz can only represent frequencies up to N/2 Hz.** That limit is the *Nyquist frequency*.

```
8,000 Hz sampling  →  max representable 4,000 Hz
16,000 Hz          →  8,000 Hz
44,100 Hz          →  22,050 Hz  (human hearing tops out ~20 kHz)
```

#### Why — the intuition

To capture one cycle of a wave you need at least two samples: one for the peak, one for the trough. Sample slower than that and you can't tell the wave apart from a slower one.

```
real signal (high freq):  ╱╲╱╲╱╲╱╲╱╲
samples (too slow):       •     •     •
reconstructed:            ╲___________╱     ← wrong, and lower
```

That misreading is called **aliasing** — a frequency too high for the sample rate doesn't vanish, it reappears disguised as a lower one. Which is why digital audio is always low-pass filtered *before* sampling, not after: once it's aliased, the damage is unrecoverable.

#### The telephony consequence, and it's severe

Phone audio is sampled at 8 kHz, so nothing above 4 kHz survives. And the phone network additionally band-limits to roughly **300–3,400 Hz** — a legacy of analogue circuits that persists in the codecs.

```
0 Hz ───┬────────────────────────┬──── 4000 Hz
        300                     3400
   gone │      what survives     │ gone
```

Everything below 300 Hz is attenuated or removed. Hold that thought — §6 is about why it nearly breaks pitch detection, and why YIN survives it.

## The frequency domain

#### Two ways to look at the same sound

**Time domain** — amplitude against time. What a waveform display shows. Good for "when did things happen".

**Frequency domain** — how much energy at each frequency. Good for "what is this made of".

The **Fourier transform** converts between them, on the principle that any signal can be decomposed into a sum of pure sine waves. The **FFT** is the fast algorithm for computing it — O(n log n) instead of O(n²), which is what made real-time audio processing possible at all.

```
time domain          frequency domain
 ╱╲  ╱╲  ╱╲            │
╱  ╲╱  ╲╱  ╲     →     │ █        peak at 200 Hz
                       │ █ ▄  ▁
                       └─────────── Hz
```

#### Spectrogram

Chop audio into short overlapping windows, FFT each one, stack the results side by side. You get frequency content *over time* — a picture of the sound. This is what ASR models actually consume: they're looking at an image, not a waveform.

#### Why this document's algorithm mostly avoids the frequency domain

The obvious way to find pitch is to FFT and take the biggest peak. It works on clean audio and it fails badly on telephony, for the reason in the next section.

YIN works in the **time domain** instead — looking for repetition, not for a peak. Understanding *why* that's the better choice here is the core insight of this whole area.

## Pitch, F0, and harmonics

#### Three terms people use interchangeably and shouldn't

**Frequency**
A physical property of a sine wave. Cycles per second.

**F0 — the fundamental frequency**
The rate at which a complex periodic signal repeats. For voice, the vocal-fold vibration rate. **Measurable.**

**Pitch**
What a listener *perceives*. Usually corresponds to F0, but it's a perception, not a measurement.

The module is careful about this: it estimates **F0**, and says so.

#### Harmonics — why a voice isn't a sine wave

Vocal folds don't produce a smooth sine. They snap open and shut, producing a sharp pulse train. Fourier says a repeating non-sinusoidal wave equals a sum of sines at **integer multiples** of the repetition rate.

```
F0 = 120 Hz  →  energy at 120, 240, 360, 480, 600, 720, ... Hz
                 └─┬─┘  └────────── harmonics ──────────┘
              fundamental

spectrum:  █ █ █ █ █ █ █ █ █ █
           │ │ │ │ │ │ │ │ │ │
          120 240 360 480 ...     evenly spaced, gap = F0
```

**The harmonics are evenly spaced, and the spacing equals F0.** That single fact is the escape hatch for telephony, and it's the next section.

#### Voiced and unvoiced

Not all speech has pitch.

| Type | Sounds | Has F0? |
|---|---|---|
| **Voiced** | vowels, *m*, *n*, *l*, *z*, *v* | Yes — folds vibrating |
| **Unvoiced** | *s*, *f*, *sh*, *t*, *p*, *k* | No — turbulent noise |

Say "sssss" then "zzzzz" with a hand on your throat: the second one buzzes. So a pitch tracker must do two things — estimate F0 *and* decide whether this frame has one at all. Reporting a confident F0 for an *s* is a bug, and it's the main source of garbage in naive implementations.

## The missing fundamental

#### The problem that makes telephony pitch detection genuinely hard

Typical adult F0 ranges: **roughly 85–180 Hz for adult men, roughly 165–255 Hz for adult women** (populations vary; treat these as orientation, not law).

The phone passband starts at about **300 Hz**.

```
              phone passband
    ┌──────────────────────────────┐
    │                              │
  0 │  300                      3400│  Hz
────┴───┬──────────────────────────┴────
   ▲    ▲
   │    └── passband starts here
   │
 typical F0 (85–255 Hz) lives HERE — below the passband
```

**For most speakers, the fundamental is filtered out before the audio ever reaches you.** The thing you are trying to measure is not in the signal.

#### Why humans don't notice

Play a tone with harmonics at 240, 360, 480 and 600 Hz but *no* 120 Hz component, and people still hear a pitch of 120 Hz. The auditory system infers the fundamental from the spacing of the harmonics.

This is a real, named phenomenon — **the missing fundamental** — and it's why a phone call doesn't sound pitch-shifted despite the low frequencies being gone.

#### Which is exactly why YIN was chosen — the docstring says so

> "F0 is estimated with the YIN algorithm, which tracks the *period* of the signal from its harmonic spacing rather than from the fundamental partial itself. That property matters on telephony audio: the phone passband (~300–3400 Hz) attenuates or removes the actual fundamental for most speakers, but the harmonics survive, so a period-based estimator still recovers F0 where a **naive spectral-peak detector would fail**."

Unpack that:

- A **spectral-peak detector** looks for the lowest strong peak and calls it F0. On telephony it finds the first surviving harmonic instead — **reporting 360 Hz for a 120 Hz speaker**, three times too high, and confidently labelling a man as a woman.
- A **period-based detector** asks "after how many samples does this waveform repeat?" A signal made of 240 + 360 + 480 Hz still repeats every 1/120 second — the fundamental period survives even when the fundamental frequency doesn't.

**This is the single best answer to "why YIN?"** in an interview. It's a specific property matched to a specific channel constraint, not a preference.

## Ways to find F0

#### The options, weakest to strongest

**Zero-crossing rate**
Count how often the signal crosses zero. Trivially cheap; useless on real speech, because harmonics add extra crossings.

**Spectral peak picking**
FFT, take the lowest strong peak. Fine on clean wideband audio. **Fails on telephony** — §6.

**Autocorrelation**
Compare the signal with delayed copies of itself; the delay that matches best is the period. Sound principle. Two flaws: biased toward short lags because the overlap is longer there, and prone to **octave errors** (a signal repeating every 100 samples also repeats every 200, so it may report half the true F0).

**AMDF**
Average Magnitude Difference Function. Same idea using absolute differences instead of products. Cheaper, similar weaknesses.

**Cepstrum**
Take the FFT *of the log spectrum*. Harmonics are periodic in frequency, so they show as a peak in the cepstrum. Clever, and less robust than YIN in noise.

**YIN**
Autocorrelation's principle with four specific fixes for its specific failures. The standard classical choice, and what's used here.

**pYIN**
YIN plus a probabilistic model tracking pitch across frames with an HMM. Better still; more machinery.

**CREPE and neural trackers**
A CNN trained on labelled pitch data. State of the art on hard audio. Needs a model, a runtime, and GPU or a chunk of CPU — a lot to add to a real-time voice pipeline for one attribute.

#### Why deliberately not ML — and the docstring is explicit

> "It deliberately does **not** use ML."

Four reasons that hold up:

- **No training data needed.** A neural pitch tracker needs labelled F0 on *your* channel and *your* speaker population, which is a data-collection project.
- **Deterministic and explainable.** The result comes with `median_f0_hz`, `voiced_frames` and a human-readable `reason`. When it's wrong you can see why.
- **Fast and dependency-free.** NumPy and an FFT. No model to load, no ONNX runtime, no GPU, nothing to version.
- **It runs on the first turn of a live call**, where a model load or a hundred milliseconds of inference is a real cost.

This is a good instinct to be able to articulate: *reach for the classical algorithm when it's sufficient, and spend the complexity budget where it actually buys something.*

## The algorithm

#### Definition

**YIN** (de Cheveigné & Kawahara, 2002) estimates F0 by finding the **period** — the lag at which the signal best repeats itself. The name is from yin and yang, referencing the interplay of autocorrelation and cancellation.

It's autocorrelation with four targeted corrections. Each step exists to fix one named failure, which makes it unusually pleasant to learn.

```
frame of audio
     │
     ▼  step 1   difference function d(τ)
     │           "how different is the signal from itself, τ samples later?"
     ▼  step 2   cumulative mean normalisation → d'(τ)
     │           kills the bias toward short lags
     ▼  step 3   absolute threshold
     │           first dip below threshold, not the global minimum
     ▼  step 4   parabolic interpolation
     │           sub-sample precision
     ▼
   F0 = sample_rate / τ
```

#### The setup in the code

```python
tau_min = floor(sample_rate / fmax_hz)    # 8000/400  = 20 samples
tau_max = ceil(sample_rate / fmin_hz)     # 8000/65   = 124 samples
```

Searching only lags 20–124 bounds the work and **rejects out-of-range answers before they can be produced** — an octave error that would land at 62 Hz simply isn't in the search space. Defaults are `fmin_hz=65`, `fmax_hz=400`, covering adult male through adult female and into child range.

There's also a frame-length guard with a stated reason:

```python
if frame_len <= 2 * tau_max:
    frame_len = 2 * tau_max + 1
```

> "YIN needs an integration window of at least one period; a frame that cannot hold two periods of the lowest pitch is unusable."

You cannot detect a repeat in a window shorter than two repeats. The default `frame_ms=40` at 8 kHz is 320 samples, comfortably more than 2 × 124.

## Step 1 — the difference function

#### The idea

For each candidate lag τ, measure how *different* the signal is from itself shifted by τ. If τ equals the period, the shifted copy lines up and the difference collapses toward zero.

```
d(τ) = Σ (x[j] − x[j+τ])²
```

#### Worked example

```
signal repeating every 4 samples:  [1, 3, 2, 0, 1, 3, 2, 0, ...]

τ=1:  compare [1,3,2,0…] with [3,2,0,1…]   → big difference
τ=2:  compare [1,3,2,0…] with [2,0,1,3…]   → big difference
τ=3:  compare [1,3,2,0…] with [0,1,3,2…]   → big difference
τ=4:  compare [1,3,2,0…] with [1,3,2,0…]   → ZERO ← the period
τ=8:  also zero (two periods — the octave-error trap)
```

Note τ=8 is also a perfect match. Every multiple of the period is. Handling that correctly is step 3's entire job.

#### Why the difference function rather than plain autocorrelation

Autocorrelation multiplies rather than subtracts, so a *louder* section scores higher regardless of how well it matches. The difference function is unaffected by that — a good match is a small difference whether the signal is loud or quiet.

It removes amplitude sensitivity. It does not remove the short-lag bias, which is the next step.

## Step 2 — cumulative mean normalisation

#### The flaw being fixed

`d(0)` is always exactly zero — the signal shifted by nothing is identical to itself. And `d(τ)` tends to be small for small τ generally, because neighbouring samples are similar.

So **taking the global minimum of d(τ) always picks τ = 0**, which reports an infinite frequency. This is YIN's signature contribution and the reason it beats naive autocorrelation.

#### The fix

Divide each value by the running average of all values up to that lag:

```
d'(τ) = d(τ) / [ (1/τ) · Σ_{k=1..τ} d(k) ]

d'(0) = 1  by definition
```

Now the question is no longer "is this difference small?" but **"is this difference small *relative to the differences seen so far*?"**

Small lags stop winning automatically, because they're compared against other small lags. A genuine period produces a dip that is dramatically below its local average, and that stands out at any lag.

#### In the code

```python
cmnd = np.ones_like(diff)
running = np.cumsum(diff[1:])
cmnd[1:] = diff[1:] * taus[1:] / np.maximum(running, 1e-12)
```
`_cumulative_mean_normalized_difference()`

Vectorised, no loop. `np.maximum(running, 1e-12)` is the divide-by-zero guard for a silent frame.

```
before:  d(τ)   ╲___╱╲______╱╲_____     always lowest at τ=0
after:   d'(τ)  ──╲__╱──╲___╱──────     clear dip AT the period
```

## Step 3 — the absolute threshold

#### The flaw being fixed: octave errors

From §9: if the signal repeats every 100 samples it also repeats every 200, 300, 400. All of those produce dips. And because of noise, the dip at 200 is sometimes *slightly deeper* than the one at 100.

Take the global minimum and you report **half the true F0** — a woman at 200 Hz becomes a man at 100 Hz. Not a small error; a category error.

#### The fix — take the first good dip, not the best one

```python
tau = tau_min
while tau < tau_max:
    if cmnd[tau] < threshold:
        # descend to the bottom of this dip
        while tau + 1 <= tau_max and cmnd[tau + 1] < cmnd[tau]:
            tau += 1
        return tau, True          # voiced
    tau += 1
return tau_min, False             # unvoiced
```
`_pick_lag()`

Walk upward from the shortest plausible lag. The *first* lag that drops below the threshold wins — then descend to the local bottom for accuracy. The true period is always shorter than its multiples, so scanning upward finds it first by construction.

#### The threshold does double duty

Default `yin_threshold = 0.15`. Comment: *"A frame is 'voiced' when its best cumulative-mean-normalised difference falls below this. Lower = stricter."*

So it simultaneously answers two questions:

- **Which lag?** The first one below it.
- **Is this voiced at all?** If *nothing* gets below it, the frame isn't periodic — it's an *s*, or noise, or silence. Return `NaN`.

That's the voiced/unvoiced decision from §5, and it comes free from the same number.

#### The tuning trade

Lower threshold: fewer frames accepted, higher confidence in each, more `unknown` results. Higher: more frames, more noise-driven garbage. 0.1–0.2 is the usual range and 0.15 sits in the middle.

## Step 4 — parabolic interpolation

#### The flaw being fixed: integer lags aren't precise enough at 8 kHz

Lags are whole numbers of samples, so F0 can only take discrete values. At 8 kHz:

```
τ = 44 samples → 8000/44 = 181.8 Hz
τ = 45 samples → 8000/45 = 177.8 Hz
                            ─────────
                            4 Hz apart
```

Now recall the production reject band: **160 Hz to 175 Hz**, a window 15 Hz wide. A 4 Hz quantisation step is a *quarter of the decision band*. Rounding error alone could flip the classification.

At telephony rates this step is not a refinement. It's necessary.

#### The fix

The true minimum lies between two samples. Fit a parabola through the dip and its two neighbours, and take the parabola's vertex.

```
  ●                    ●
     ╲                ╱
      ●____________●          ← integer samples
           ▲
        true minimum, between them

left, mid, right = cmnd[τ-1], cmnd[τ], cmnd[τ+1]
denominator = left + right - 2*mid
return τ + 0.5 * (left - right) / denominator
```
`_parabolic_interpolation()`

Three points define a parabola exactly, and the vertex formula is closed-form — a handful of arithmetic operations, no iteration. Guards handle a zero denominator (a flat dip) and boundary lags.

Then finally:

```python
return float(sample_rate / refined_tau)
```

## The FFT shortcut

#### The performance problem

Computed directly, the difference function is O(n × τ_max) per frame. At 320 samples and 124 lags that's ~40,000 operations per frame, times 100 frames a second, on every call. On 64 pods each handling many calls, that adds up to real CPU.

#### The trick

Expand the square:

```
d(τ) = Σ (x[j] − x[j+τ])²
     = Σ x[j]²  +  Σ x[j+τ]²  −  2·Σ x[j]·x[j+τ]
       └──┬──┘     └───┬───┘       └──────┬──────┘
       energy       energy         autocorrelation
```

Three terms, all cheap:

- The two energy terms come from a **cumulative sum** of x² — O(n) once, then O(1) per lag.
- The autocorrelation comes from the **FFT**, via the Wiener–Khinchin relation: transform, multiply by the conjugate, transform back. O(n log n).

```python
size = 1 << (2 * n - 1).bit_length()          # zero-pad to a power of two
spectrum = np.fft.rfft(frame, size)
autocorr = np.fft.irfft(spectrum * np.conjugate(spectrum), size)[: tau_max + 1]

cumulative = np.concatenate(([0.0], np.cumsum(power)))
energy_head = cumulative[n - taus]
energy_tail = cumulative[n] - cumulative[taus]

diff = energy_head + energy_tail - 2.0 * autocorr
```
`_cumulative_mean_normalized_difference()`

The code's own comment: *"The squared-difference function is computed via FFT autocorrelation so the whole thing is O(n log n) rather than O(n * tau_max)."*

The zero-padding to `2n−1` rounded up to a power of two matters: FFT-based correlation is *circular*, so without padding the end of the signal wraps around and contaminates the beginning.

#### The nice irony

YIN is a time-domain algorithm chosen specifically because frequency-domain peak picking fails on telephony — and it uses an FFT internally purely as a fast way to compute a time-domain quantity.

The FFT here is an *implementation detail*, not the method. Worth saying if someone asks "isn't this just spectral analysis?"

## The F0 distributions

#### The classification problem

You have a median F0. Now: male or female?

Typical adult ranges — treat as orientation, since populations, languages and ages vary:

```
adult male:    ~85 ────────── 180 Hz
adult female:        ~165 ────────── 255 Hz
                      └──┬──┘
                    OVERLAP ~165–180
```

#### Why a single threshold is the wrong design

Pick 170 Hz. Now every speaker at 169 Hz is confidently labelled male and every speaker at 171 Hz confidently female — and in that region the distributions genuinely overlap, so **you are close to guessing while sounding certain**.

That's the worst possible failure mode for something that drives how the bot addresses a customer. Being wrong is bad; being wrong *and confident* is worse, because nothing downstream can tell.

## The reject option

#### Definition

A **reject option** — also called classification with abstention — lets a classifier output *"I don't know"* as a legitimate third answer instead of forcing a choice.

It's a real technique with a real literature, and the underlying idea is simple: **if the cost of a wrong answer exceeds the cost of no answer, abstaining is the optimal decision** in the ambiguous region.

#### The implementation — a band, not a line

```
median F0 < low_hz              → MALE
median F0 > high_hz             → FEMALE
low_hz ≤ median F0 ≤ high_hz    → UNKNOWN
```
```
       MALE          UNKNOWN         FEMALE
  ──────────────┤              ├──────────────
               160            175            Hz
```

Production defaults: `low_hz = 160.0`, `high_hz = 175.0`. A 15 Hz abstention band placed over the overlap region.

#### The design note in the code is the part worth quoting

> "The band is intentionally a config knob, not a hardcoded constant: the right boundaries depend on the channel and speaker population and should be tuned on real labelled data. The defaults below are textbook clean-speech values and are **only a starting point**."

Two good instincts in one paragraph. The boundaries are exposed as configuration because they're empirical, not universal. And the docstring says out loud that the defaults are unvalidated — so nobody later mistakes a textbook number for a measured one.

The band width is the tuning dial:

| Band | Effect |
|---|---|
| **Wider** | More `unknown`, higher accuracy on the ones you do label |
| **Narrower** | Fewer `unknown`, more errors near the boundary |
| **Zero width** | A plain threshold — maximum coverage, maximum confident errors |

#### Why abstention is the right call *for this use case specifically*

The output drives persona and salutation. So consider what each outcome costs:

| Outcome | Caller experiences |
|---|---|
| Correct | "Good morning, sir" — a small, pleasant touch |
| `unknown` → neutral | "Good morning" — perfectly fine, nothing lost |
| **Wrong** | Misgendered by a machine in the first sentence |

**The upside of a correct guess is small. The downside of a wrong one is large. And abstaining costs almost nothing.** That asymmetry is the entire argument, and it's the answer to give if asked to justify the design.

## Evidence guards

The band handles ambiguous *pitch*. Three more guards handle insufficient *evidence* — a different failure, and one people forget.

#### Guard 1 — no frames at all

```python
if total_frames == 0:
    → UNKNOWN, reason="audio too short to form a single analysis frame"
```

#### Guard 2 — not enough voiced speech

```python
min_voiced_frames = 5       # absolute floor
min_voiced_ratio  = 0.10    # at least 10% of frames voiced

if voiced_frames < 5 or voiced_ratio < 0.10:
    → UNKNOWN, reason="insufficient voiced speech (frames=3/40, ratio=0.08)"
```

The comment: *"Too little voiced speech → unknown rather than a coin flip."*

Both conditions are needed, and they catch different things. The **absolute count** catches a very short utterance. The **ratio** catches a long stretch of mostly noise with a couple of accidental voiced-looking frames — where the count would pass but the evidence is junk.

#### Guard 3 — the RMS silence gate

```python
if np.sqrt(np.mean(frame ** 2)) < 1e-4:
    return float("nan")
```

With a genuinely lovely comment:

> "Silence / near-silence has no pitch. A zero-energy frame yields an all-zero difference function, which YIN would otherwise **misread as perfectly periodic**."

This is the subtlest bug in the whole module. Silence is all zeros; the difference between zero and zero is zero *at every lag*; so `d'(τ)` is below threshold immediately and YIN reports the shortest lag with total confidence. **Silence looks like maximum periodicity.** Without this three-line gate, every pause between words would contribute a spurious high-frequency reading and drag the median upward.

#### And the median, which is a guard in itself

```python
median_f0 = float(np.median(voiced))
```

> "Median is robust to the octave-error outliers YIN occasionally emits."

Step 3 makes octave errors rare, not impossible. A *mean* would be dragged by one frame reporting double or half. The **median** ignores outliers entirely as long as they're a minority — so a handful of bad frames among forty good ones change nothing.

Choosing median over mean is a one-word decision that removes an entire class of failure. Worth noticing.

#### The result object carries its own evidence

```python
GenderPitchResult(
    gender       = Gender.MALE,
    median_f0_hz = 128.4,
    voiced_frames= 31,
    total_frames = 47,
    voiced_ratio = 0.66,
    reason       = "median F0 128.4 Hz < low_hz 160.0 Hz",
)
```

Not a bare label — the number, the evidence behind it, and a sentence explaining the decision. When something looks wrong in production you can tell immediately whether it was a bad F0 estimate, insufficient voiced audio, or a correctly-applied band you disagree with.

**That's a pattern worth generalising:** a classifier that returns only a label is a classifier you cannot debug.

## How it's wired into a call

#### The path through the pipeline

```
transport.input()
     ↓
GenderIdentificationProcessor      ← FIRST, before the STT mute filter
     ↓
stt_mute_processor
     ↓
asr_pipeline ...
```

Placement is deliberate and commented in `pipecat_bots.py`:

> "Placed right after transport input so it sees **raw user audio and VAD boundaries** before the STT mute filter can suppress them."

Anywhere later and the audio it needs might already be gone.

#### The gating problem, and its one-shot solution

The result must exist *before* the first LLM call, or the persona variable is empty for the greeting — the one turn where a salutation matters most.

So the user-turn stop strategy gates on it:

```python
if self._gender_detection_ongoing:
    self._gender_detection_ongoing = False
    try:
        self._gender_processor._on_user_stopped_speaking()
    except Exception as e:
        logger.error(f"First-turn gender identification failed: {e}")
await self.trigger_user_turn_stopped()
```
`pipeline/endpointing.py · ModUserTurnStopStrategy._loop()`

Three things about this:

- **The flag is cleared *before* the call**, so a failure can never block a second turn.
- **Wrapped in try/except** — the comment says "one shot, win or lose". Gender identification must never be able to break a call.
- **It's why the stop strategy uses a polling loop** rather than committing on a frame: *"the processor's own stop frames reach it ~150 ms after this commit… so frame order can't be relied on."* A single commit path gives exactly one place to gate.

The result then reaches the flow as a prompt variable, driving persona and salutation.

## Evaluating it

#### Accuracy alone is meaningless here — and this is the metric insight

With a reject option there are two numbers, and they trade against each other:

**Coverage**
The fraction of calls where you produced a label at all — not `unknown`.

**Selective accuracy**
Of the calls you *did* label, the fraction correct.

Widen the band and coverage falls while selective accuracy rises. A system that abstains on everything has 100% selective accuracy and 0% coverage, and is useless. **Quoting one without the other is meaningless** — that's the trap, and naming it is the strong answer.

#### How to tune the band properly

1. Collect real calls from your channel and speaker population, with human gender labels. A few hundred.
2. Run the estimator and record the median F0 for each.
3. Plot the two F0 distributions. The overlap you see is the band you need.
4. Sweep `low_hz` and `high_hz` and plot **coverage against selective accuracy**.
5. Choose the point matching your cost ratio. Since a wrong answer is much worse than no answer here, sit toward high accuracy.

**This is what the docstring is asking for** when it says the defaults are "textbook clean-speech values and only a starting point". If you've done it, quote the numbers; if not, say the defaults are untuned. The second answer is still a good one — it shows you know what validation would require.

#### Report by subgroup, not in aggregate

A single accuracy number hides the failures that matter. Break it down by gender (the two classes fail at different rates), by language and region, by call duration (short calls have fewer voiced frames), and by codec.

An aggregate that looks fine can hide a subgroup performing at chance — and that subgroup is somebody's actual customers.

## Limits and ethics

#### Be able to say this unprompted — it reads as maturity, not hedging

**What the system measures is fundamental frequency. That is not gender.**

- Gender is not binary, and a two-class-plus-unknown output cannot represent people outside it.
- Voice pitch does not determine gender identity. Trans and non-binary speakers, and plenty of cisgender speakers, sit anywhere in the range.
- F0 shifts with age, illness, fatigue, emotion and time of day.
- Children have high F0 regardless of gender.
- The ranges are population statistics, and populations differ by language and region.

#### What makes this deployment defensible

Four properties, and they're the right four:

- **Low stakes.** It picks a salutation. It doesn't decide eligibility, pricing or access. The same technique gating a service would not be acceptable.
- **Abstention is designed in.** The system is built to decline rather than force a label.
- **Graceful default.** `unknown` produces a neutral greeting — which is a perfectly good greeting. There is no degraded experience.
- **It's a hint, not a record.** A prompt variable for this call, not a stored attribute on a customer profile.

#### The line to hold

If someone proposes using this signal for anything consequential — routing, pricing, eligibility, retention in a profile — the honest engineering answer is **no**. An estimator with a known ambiguous region and a documented population-dependent threshold is not evidence about a person. It is a guess that is right often enough to be a pleasant touch and wrong often enough to matter.

Being the person who says that in the design review is worth more than the feature.

## Alternatives

#### Other ways to get the same signal

| Approach | Trade-off |
|---|---|
| **YIN + reject band** (used) | No training data, deterministic, explainable, fast. Only uses F0, so it ignores other cues. |
| **Formants as well as F0** | Vocal-tract resonances correlate with tract length and add real information beyond pitch. More signal; formant tracking on 8 kHz audio is itself hard. |
| **CNN on a spectrogram** | Uses every cue at once, likely more accurate. Needs labelled data on your channel, a model runtime, and it's opaque when wrong. |
| **Speaker embeddings (x-vector / ECAPA)** | Rich speaker representation, and you get speaker verification for free. Heavier, and needs a trained head for this attribute. |
| **Pretrained gender classifier** | Fast to adopt. Trained on clean wideband audio, so telephony performance is unknown until you measure it. |
| **Ask, or use CRM data** | Actually correct rather than inferred. Available whenever the caller is a known customer — and honestly the best option when it exists. |

**The strongest answer to "how would you improve this?"** is the last row: for known customers, use the record you already have and skip inference entirely. Reserve the estimator for unknown callers. That's a better system, and proposing it shows you're solving the problem rather than defending the implementation.

## How to test, and where to breakpoint

#### 1 · Synthetic signals with known F0 — start here

```python
sr = 8000
t = np.arange(0, 1.0, 1/sr)
# fundamental plus harmonics
sig = np.sin(2*np.pi*120*t) + 0.5*np.sin(2*np.pi*240*t) \
                            + 0.3*np.sin(2*np.pi*360*t)
result = identify_gender(sig, sr)
assert abs(result.median_f0_hz - 120) < 2
```

Deterministic, no fixtures, catches most algorithm bugs immediately.

#### 2 · The missing-fundamental test — the important one

```python
# harmonics ONLY, no 120 Hz component — simulates the phone passband
sig = np.sin(2*np.pi*240*t) + np.sin(2*np.pi*360*t) + np.sin(2*np.pi*480*t)
result = identify_gender(sig, sr)
assert abs(result.median_f0_hz - 120) < 5    # must still find 120
```

This is the property the whole design rests on. If it regresses, telephony accuracy collapses silently — and a normal test on clean audio would still pass.

#### 3 · Guard tests

- **Silence** → `UNKNOWN`, not a confident high F0. Tests the RMS gate.
- **White noise** → `UNKNOWN`. Tests the threshold's voiced/unvoiced role.
- **50 ms of audio** → `UNKNOWN` with the too-short reason.
- **Mostly-unvoiced speech** ("sssss") → `UNKNOWN` via the voiced ratio.
- **F0 exactly on a band edge** → the documented side, deterministically.

#### 4 · Real telephony recordings

Labelled real calls from your actual channel. Report coverage and selective accuracy, broken down by subgroup. This is the only test that tells you whether the band is right — everything above only tells you the algorithm is correct.

#### 5 · Band-sweep as a report, not a test

Sweep `low_hz` and `high_hz` over the labelled set and emit the coverage/accuracy curve. Run it whenever the audio path changes — a new codec or a new noise filter moves the distributions.

#### Where to breakpoint

**The per-frame F0 array**
Before the median. Are the values clustered, or scattered across octaves? Scatter means the threshold or the search range is wrong.

**`voiced_ratio`**
Very low means the audio isn't reaching the processor, or the threshold is too strict.

**The CMND curve for one frame**
Plot it. A clean single dip means it's working; multiple equal dips means octave ambiguity.

**Median vs the band**
The classification itself is one comparison — if the F0 is right and the label is wrong, the band is wrong.

**The `reason` string**
Log it always. It distinguishes "estimated and classified" from "didn't have enough audio" without any further investigation.

## Interview answers

**Q: Explain how the gender identification works.**

"It estimates the speaker's fundamental frequency from the first turn of audio and classifies it against a band.

F0 estimation uses YIN — frame the audio at 40 ms with 10 ms hops, and for each frame find the lag at which the signal best repeats itself. Frames that aren't periodic come back as unvoiced. Then take the median F0 across the voiced frames, because the median is robust to the occasional octave error YIN emits.

Classification is a reject-option band rather than a threshold: below 160 Hz male, above 175 Hz female, in between unknown. Plus evidence guards — if there aren't at least five voiced frames and at least 10% of frames voiced, it returns unknown rather than guessing.

The result surfaces to the flow as a prompt variable driving persona and salutation, and unknown falls back to a neutral greeting."

**Q: Why YIN specifically?**

The best question in this area, and the answer is genuinely specific.

"Because of the phone passband. Typical adult F0 runs from about 85 to 255 Hz, and the phone network band-limits to roughly 300 to 3400 Hz — so **the fundamental is filtered out before we ever see the audio**.

A spectral peak detector would find the lowest surviving peak, which is the first harmonic — reporting 360 Hz for a 120 Hz speaker. Three times too high, and confidently misclassified.

YIN is period-based. It asks how many samples until the waveform repeats, and a signal built from harmonics at 240, 360 and 480 still repeats at the 120 Hz period. The fundamental frequency is gone but the fundamental period survives, so YIN recovers it. It's the same reason humans still hear the right pitch on a phone — the missing fundamental.

Second reason: it's deliberately not ML. No training data, deterministic, explainable, and no model to load — which matters because it runs on the first turn of a live call."

**Q: What is a reject option and why use one?**

"It's letting the classifier answer 'I don't know' instead of forcing a choice. Formally, abstention is optimal when the cost of a wrong answer exceeds the cost of no answer.

Here the distributions genuinely overlap around 165 to 180 Hz. A single threshold at 170 would label someone at 169 as male and someone at 171 as female, both confidently, in a region where it's essentially guessing.

The cost asymmetry decides it. A correct guess buys a slightly warmer greeting. A wrong one misgenders a customer in the first sentence. And abstaining costs nothing, because a neutral greeting is perfectly fine. Small upside, large downside, free fallback — so you abstain in the ambiguous region.

The band is config rather than a constant, because the right boundaries depend on the channel and the speaker population and should be tuned on real labelled data. The defaults we ship are textbook clean-speech values, which I'd treat as a starting point rather than validated."

**Q: Walk me through the YIN steps.**

"Four steps, and each one fixes a specific failure of plain autocorrelation.

One, the difference function: for each candidate lag, sum the squared differences between the signal and itself shifted by that lag. Using differences rather than products removes sensitivity to loudness.

Two, cumulative mean normalisation — divide each value by the running average of all values up to that lag. Without it, lag zero is always the global minimum and you'd report infinite frequency. This is YIN's signature contribution.

Three, an absolute threshold: take the *first* dip below the threshold rather than the global minimum, then descend to its local bottom. That fixes octave errors, because a signal repeating every 100 samples also repeats at 200 and 300, and noise can make a multiple look deeper. Scanning upward finds the true period first by construction. The same threshold doubles as the voiced/unvoiced decision — if nothing gets below it, the frame isn't periodic.

Four, parabolic interpolation for sub-sample precision. At 8 kHz, adjacent integer lags near 180 Hz are about 4 Hz apart, and the decision band is only 15 Hz wide — so quantisation alone could flip the classification. It's necessary, not cosmetic.

The implementation computes the difference function via FFT autocorrelation, so it's O(n log n) rather than O(n·τmax)."

**Q: What's the trickiest bug in that code?**

"The silence gate, and it's counter-intuitive.

Silence is all zeros. The difference between zero and zero is zero at *every* lag. So the normalised difference function is below threshold immediately, and YIN reports the shortest lag with maximum confidence — **silence looks like perfect periodicity**.

Without a three-line RMS check gating frames below about −80 dBFS, every pause between words would contribute a spurious high-frequency reading and drag the median upward. And the failure is silent: you'd just get slightly wrong answers that skew female, with no error anywhere.

It's a good example of a general point — an algorithm's degenerate input often produces a confident wrong answer rather than an obvious failure, and those are the cases worth writing guards for."

**Q: How accurate is it?**

Answer the metric question before the number question.

"Accuracy alone isn't meaningful with a reject option — there are two numbers. Coverage is the fraction of calls you labelled at all; selective accuracy is how often those labels were right. They trade off directly: widen the band and coverage falls while accuracy rises. A system that abstains on everything is 100% accurate and useless.

To tune it properly you need real labelled calls from your own channel, then you sweep the band and plot coverage against selective accuracy and pick the point matching your cost ratio — which here sits toward high accuracy, since a wrong answer costs much more than no answer.

I'd also insist on reporting it by subgroup rather than in aggregate — by gender, language and call duration — because an aggregate can look fine while one subgroup performs at chance.

And I'd be upfront that the shipped band is textbook values, not tuned on production data. The code says so explicitly."

**Q: Any concerns about inferring gender from voice?**

Have this ready — it may be asked as a values question as much as a technical one.

"Yes, and I'd rather raise them than be asked.

What the system measures is fundamental frequency, which is not gender. Gender isn't binary, voice pitch doesn't determine gender identity, and F0 varies with age, illness, fatigue and emotion. The ranges are population statistics that shift across languages and regions.

What makes this particular use defensible is the stakes and the design. It picks a salutation — it doesn't gate access, pricing or routing. Abstention is built in rather than bolted on. Unknown produces a neutral greeting, which is a perfectly good greeting, so there's no degraded path. And it's a per-call hint, not an attribute written to a customer record.

If someone proposed using the same signal for anything consequential, I'd push back. An estimator with a documented ambiguous region and a population-dependent threshold isn't evidence about a person.

The better system, honestly, is to use CRM data for known callers and only infer for unknown ones."

## Glossary

**Amplitude** — Size of the pressure swing. Heard as loudness.

**Frequency** — Cycles per second, in Hz.

**Pitch** — The perceived counterpart of frequency.

**F0** — Fundamental frequency — the repetition rate of a periodic signal.

**Harmonic** — Energy at an integer multiple of F0.

**Missing fundamental** — Perceiving F0 from harmonic spacing when F0 itself is absent.

**Source-filter model** — Vocal folds make the buzz; the tract shapes it.

**Voiced / unvoiced** — Folds vibrating (has F0) versus turbulent noise (no F0).

**Sample rate** — Measurements per second. 8 kHz for telephony.

**Nyquist frequency** — Half the sample rate; the highest representable frequency.

**Aliasing** — Too-high frequencies masquerading as lower ones.

**PCM** — Raw uncompressed samples.

**DC offset** — A constant added to every sample. Removed before analysis.

**Passband** — Frequencies a channel lets through. ~300–3400 Hz on a phone.

**FFT** — Fast Fourier Transform. Time domain to frequency domain in O(n log n).

**Spectrogram** — Frequency content over time.

**Autocorrelation** — Correlating a signal with delayed copies of itself.

**YIN** — Period-based F0 estimator; autocorrelation with four fixes.

**Difference function** — Squared difference between the signal and its lagged copy.

**CMND** — Cumulative mean normalised difference. Removes short-lag bias.

**Octave error** — Reporting half or double the true F0.

**Parabolic interpolation** — Fitting a parabola to reach sub-sample precision.

**Lag / τ** — The candidate period, in samples. F0 = sample_rate / τ.

**Reject option** — Allowing an "I don't know" output.

**Coverage** — Fraction of inputs given a label.

**Selective accuracy** — Accuracy on the inputs that were labelled.

**RMS** — Root mean square — a measure of signal energy.

**pYIN / CREPE** — Probabilistic and neural successors to YIN.

---

Written from `app/runtime/voice/utils/gender_from_pitch.py`, `processors/gender_identification.py` and `pipeline/endpointing.py`.
F0 ranges are population orientation figures, not measurements of any specific speaker group. Companion documents: anatomy of a call · NLP stack · telephony · voice runtime from zero.
