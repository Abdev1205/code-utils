# From Sound to Meaning

**Topic:** NLP
**Covers:** Classical NLP, then all 15 stages of a voice bot with purpose and drawbacks
**Source:** [Claude artifact](https://claude.ai/artifact/QuD5Po3ydxFhQk1BQLLSbE) — written by a colleague, mirrored here for study.

What natural language processing actually is, then the complete voice-bot chain — fifteen stages from a microphone to a spoken reply — with the purpose, the mechanism, the drawbacks and the tooling for every single one.

**The shape of the problem.** A voice bot has roughly **1.5 seconds** between someone finishing a sentence and starting to sound broken. In that window it must decide the person stopped talking, transcribe what they said, work out what they meant, decide what to do, do it, compose a reply, and start making sound.

Every stage in this document is a decision about how to spend part of that budget. That constraint explains almost every architectural choice in the field.

## Why language is hard

**What NLP is.** **Natural language processing** — getting computers to work with human language. Not a single technique; a field covering everything from splitting text into words to holding a conversation.

It is hard for one reason above all: **language is ambiguous at every level, and humans resolve the ambiguity using knowledge they never state.**

### The five layers of ambiguity

| Layer | Example | The problem |
|---|---|---|
| **Lexical** | "I went to the *bank*" | Which bank? Money or river? |
| **Syntactic** | "I saw the man with the telescope" | Who has the telescope? |
| **Semantic** | "The trophy didn't fit in the suitcase because *it* was too big" | What is "it"? Change "big" to "small" and the answer flips. Resolving it needs knowledge of physical containment. |
| **Pragmatic** | "Can you tell me my balance?" | Literally a yes/no question. Actually a request. Answering "yes" is technically correct and useless. |
| **Discourse** | "And the other one?" | Meaningless without the previous three turns. |

**Speech adds four more problems on top.** Everything above assumes clean text. Spoken input isn't:

- **No punctuation and no sentence boundaries.** Where one thought ends is something you have to *infer*.
- **Disfluency.** "um", "so like", false starts, self-corrections — "my account, no wait, my *other* account".
- **Homophones the audio cannot distinguish.** "two" / "to" / "too", "eight" / "ate". Only context decides.
- **Errors upstream.** Every later stage receives an imperfect transcript, and mistakes compound rather than cancel.

This is why voice is meaningfully harder than chat, and it's worth saying explicitly in an interview — people underestimate it.

## The classical pipeline

Before neural networks, NLP was a chain of explicit steps. They're worth knowing — partly because the vocabulary persists, partly because several are still used, and partly because interviewers who learnt NLP before 2018 will ask.

### A · Text normalisation

**Purpose.** Reduce pointless variation. Lowercase, strip punctuation, normalise Unicode, expand contractions, collapse whitespace.

**Drawbacks.** Lowercasing destroys information — "US" and "us", "Apple" and "apple". Stripping punctuation destroys sentence boundaries and meaning ("let's eat, grandma"). Every normalisation is a lossy decision, and modern models generally want the original text.

### B · Tokenisation

**Purpose.** Split text into units. Classically words; now subwords (see the language-model document).

**Drawbacks.** "Splitting on spaces" fails for Chinese, Japanese and Thai, which have none. It also mangles "New York", "don't", "state-of-the-art" and URLs. Subword tokenisation solved the vocabulary problem but destroyed character-level information.

### C · Stop-word removal

**Purpose.** Delete high-frequency words — "the", "is", "at" — on the theory that they carry no meaning. Made sense when you were counting words and every dimension cost memory.

**Drawbacks.** **Mostly harmful now, and worth knowing why.** "To be or not to be" becomes empty. Negation disappears — "not working" and "working" become identical, which is catastrophic for a support bot. And "The Who" becomes nothing.

Modern models handle common words fine. If someone proposes stop-word removal in 2026, the answer is usually no.

### D · Stemming and lemmatisation

**Purpose.** Collapse word forms so "running", "ran" and "runs" match each other.

**Stemming** chops suffixes by rule — crude, fast, and it produces non-words. **Lemmatisation** uses a dictionary and part-of-speech to find the real base form.

```
            stem      lemma
running  →  run    →  run
better   →  better →  good      ← lemmatiser knows this
studies  →  studi  →  study     ← stemmer produces a non-word
was      →  wa     →  be
```

**Drawbacks.** Stemming over-collapses ("university" and "universe" both → "univers") and under-collapses irregulars. Lemmatisation is slower and needs a language-specific dictionary — poor coverage for Indian languages. Both are largely unnecessary with embeddings, which capture the relationship without destroying the surface form.

**Still used for.** BM25 and keyword search, where matching is literal. That's a real use, not a legacy one.

### E · POS tagging

**Purpose.** Label each word with its part of speech — noun, verb, adjective. Disambiguates "book a flight" (verb) from "read a book" (noun).

**Drawbacks.** Accurate on clean text, much worse on speech transcripts with no punctuation and disfluency. Rarely a separate step now — transformers learn syntax implicitly.

### F · Parsing

**Purpose.** Recover grammatical structure. **Constituency parsing** builds a tree of phrases; **dependency parsing** links each word to the word it modifies.

```
       "cancel my flight to Delhi"

  cancel ──obj──► flight ──poss──► my
     │                └──prep──► to ──► Delhi
```

**Drawbacks.** Slow, brittle on ungrammatical input — which spoken language routinely is — and language-specific. Genuinely useful in linguistics and some information extraction; rarely in a production voice bot.

### G · Named entity recognition

**Purpose.** Find and classify the entities: people, places, organisations, dates, money, and domain-specific types like account numbers or policy IDs.

```
"transfer 5000 rupees to Priya on Friday"
           [MONEY]        [PERSON] [DATE]
```

**Still genuinely important** — this is how you extract the values a transaction needs.

**Drawbacks.** Needs labelled training data per entity type per language. Struggles with unseen names, and Indian names are badly under-represented in most pretrained models. On telephony audio the entity is often mis-transcribed before NER even sees it.

**Stack.** spaCy or a fine-tuned BERT classically; increasingly a prompted LLM returning a structured object, which handles the long tail far better.

### H · Coreference resolution

**Purpose.** Work out what pronouns refer to. "I have two accounts. Close *the second one*."

**Drawbacks.** Genuinely hard — the trophy/suitcase example needs world knowledge. Classical systems were poor at it. LLMs are much better, and this is one of the clearest places where the neural era simply won.

## Turning text into numbers

Every model needs numbers. The history of how NLP represented text is essentially the history of the field.

### 1 · Bag of words

**Purpose.** Count each vocabulary word's occurrences. A document becomes a long sparse vector of counts.

**Drawbacks.** **Word order is completely discarded** — "dog bites man" and "man bites dog" are identical. Vectors are huge and mostly zeros. No notion that "car" and "automobile" are related.

### 2 · TF-IDF

**Purpose.** Weight each word by how often it appears here (term frequency) against how rare it is overall (inverse document frequency). Rare words are informative; "the" isn't.

**Drawbacks.** Still no word order, still no synonyms. But it's cheap, interpretable and a strong baseline — BM25 is its refined descendant and remains excellent for exact-term search.

### 3 · n-grams

**Purpose.** Count pairs and triples rather than single words, recovering a little local order. "not working" becomes its own feature, which fixes the negation disaster.

**Drawbacks.** The feature space explodes combinatorially, and it only sees a window of two or three words.

### 4 · Word2Vec, GloVe, fastText

**Purpose.** The 2013 breakthrough. Learn a dense vector per word from the company it keeps, so that similar words land near each other. This is where `king − man + woman ≈ queen` comes from.

fastText added subword information, so it can embed a word it has never seen — valuable for morphologically rich languages.

**Drawbacks.** **One vector per word, regardless of context.** "bank" has a single vector averaging both meanings, so it's slightly wrong in every sentence. And still no sentence-level structure.

### 5 · Contextual embeddings

**Purpose.** ELMo and then BERT (2018) produced a *different* vector for a word depending on its sentence. "River bank" and "savings bank" finally got different representations.

BERT is a bidirectional transformer encoder pretrained by masking words and predicting them. Fine-tuning it on a small labelled set gave state-of-the-art results on nearly every task overnight — this is the moment classical NLP pipelines stopped being competitive.

**Drawbacks.** Heavier to run than counting words. Needs fine-tuning data per task. And it can't generate text — it's an encoder.

**Still very much in use.** Embedding models for RAG, rerankers, and fast intent classifiers are all BERT-family. When you need a cheap, fast, deterministic classifier, this — not an LLM — is usually the right tool.

### 6 · Generative LLMs

**Purpose.** One model, prompted, does classification, extraction, generation and reasoning without task-specific training.

**Drawbacks.** Slow and expensive relative to a small classifier, non-deterministic, and it will confidently invent things. For a task a BERT classifier does in 10 ms for a hundredth of a cent, reaching for an LLM is often the wrong call.

## Three eras, three stacks

| Era | Approach | Failed because |
|---|---|---|
| **Rules**<br>1950s–1990s | Hand-written grammars, keyword patterns, regex, decision trees written by linguists | Language has an infinite tail. Every rule needs an exception, and every exception needs an exception. |
| **Statistical**<br>1990s–2015 | Learn from labelled corpora. Naive Bayes, HMMs, CRFs, SVMs, TF-IDF features | Needed huge labelled datasets and hand-designed features per task. Didn't transfer between tasks. |
| **Neural**<br>2015–now | Pretrain on unlabelled text, then adapt. Word2Vec → BERT → GPT | Currently winning. Costs: opacity, hallucination, compute. |

**The thing that actually changed.** **Transfer learning.** Before 2018, every task started from zero and needed its own labelled dataset. After, you started from a model that already knew the language and fine-tuned with a fraction of the data.

That's the pivot, and it's a better answer than "transformers" if someone asks what changed — transformers were the architecture that made pretraining at scale practical, but pretraining-and-adapting is the idea.

**All three eras are still in production, often in the same system.** A real voice bot might have: regex for phone numbers (rules), a BERT intent classifier (statistical/neural hybrid), an LLM for the open-ended turns, and BM25 in its retrieval. Each is the right tool for its job.

"We use LLMs for everything" is usually a sign nobody measured the alternatives.

## The whole chain

```
  caller speaks
       │
  ┌────▼────────────────────────────────────────────┐
  │  1  audio in            telephony → PCM frames  │
  │  2  VAD                 is anyone speaking?     │
  │  3  ASR                 audio → text            │
  │  4  endpointing         have they finished?     │
  ├─────────────────────────────────────────────────┤
  │  5  normalise           clean text for meaning  │
  │  6/7 NLU                what do they want?      │
  │  8  dialogue state      what do we know so far? │
  │  9  policy              what do we do next?     │
  │ 10  tools               do it                   │
  ├─────────────────────────────────────────────────┤
  │ 11  NLG                 compose the reply       │
  │ 12  normalise           written → speakable     │
  │ 13  TTS                 text → audio            │
  │ 14  barge-in            handle interruption     │
  └────┬────────────────────────────────────────────┘
       │
  caller hears

  ... 15  after the call: summarise, score, analyse
```

**Two properties of this chain that govern everything.** **Errors compound.** ASR is 92% accurate, NLU is 92% accurate on clean text — end to end you are nowhere near 92%. Each stage receives the previous stage's mistakes and adds its own. This is the core argument for designing every stage to degrade gracefully rather than assuming clean input.

**Latency accumulates.** Every stage adds milliseconds and they simply add up. Which is why the whole industry streams: stage *n+1* starts on partial output from stage *n* rather than waiting for it to finish.

## 1 · Audio in

### 01 · Capture and transport

**Purpose.** Get the caller's voice into your process as a stream of numbers. Audio arrives over the phone network as RTP packets, gets decoded from its codec, and becomes PCM samples — raw amplitude values, typically 8,000 or 16,000 per second.

**Stack.** SIP/RTP from the carrier, a media server or SFU, then a transport into your application — WebRTC via LiveKit, or gRPC streaming. Frames typically arrive every 10–40 ms.

**Drawbacks and constraints.**

- **Telephony is 8 kHz.** That caps the representable audio at 4 kHz, and the phone band is roughly 300–3,400 Hz. Everything above is simply gone — which is why "S" and "F" are so easily confused on a phone call, and why ASR is meaningfully harder here than on a laptop microphone.
- **Lossy codecs.** G.711 is tolerable; heavily compressed codecs degrade ASR measurably.
- **Packet loss and jitter.** Missing audio becomes missing words, and the ASR has no way to know a gap occurred.

See the telephony document for how any of this gets to you.

## 2 · Voice activity detection

### 02 · VAD

**Purpose.** Answer one question, continuously: *is there speech in this 20 ms of audio?*

Three jobs depend on it. Don't send silence to a paid ASR. Know when the caller *starts* talking so you can stop the bot (barge-in). Know when they stop, as the first input to endpointing.

**How it works.** Classically: energy thresholds and zero-crossing rate — loud and complex enough means speech. Cheap and easily fooled.

Now: a tiny neural network (Silero VAD is the common choice) trained to distinguish speech from everything else. Runs in well under a millisecond on CPU, and is dramatically better in noise.

**Drawbacks.**

- **Background speech.** A TV, an office, another conversation — VAD says "speech" because it *is* speech, just not your caller's.
- **The threshold is a genuine trade-off.** Sensitive: the bot gets interrupted by coughs and background noise. Conservative: real barge-ins are missed and the bot talks over the caller. There is no setting that avoids both.
- **Quiet or breathy speakers** get clipped at the start of their utterance, so the first word is lost.
- **It says nothing about meaning.** "Mm-hmm" is speech; it is not a turn.

## 3 · Speech recognition

### 03 · ASR / STT

**Purpose.** Audio in, text out. The single most consequential stage — every downstream component works from this output, and errors here are unrecoverable.

**How it works.** Audio is turned into a spectral representation — a picture of which frequencies are present over time — and a neural network maps that to characters or subwords.

Classically this was three separate models: an acoustic model (sound → phonemes), a pronunciation lexicon, and a language model (which word sequences are plausible). Modern systems are **end-to-end**: one network, audio to text, trained on paired data. Simpler and better, at the cost of being harder to inject domain knowledge into.

**Streaming vs batch — the distinction that matters.** **Batch**: wait for the whole utterance, transcribe it once. Most accurate, because the model sees all the context. Adds the full utterance duration to latency.

**Streaming**: emit text as audio arrives.

```
  0.4s  "I want"                    ← partial, may change
  0.8s  "I want to can"             ← partial
  1.1s  "I want to cancel my"       ← partial
  1.6s  "I want to cancel my order" ← FINAL
```

**Partials are unstable and will be revised.** Acting on a partial is how you get a bot that responds to half a sentence. But partials are also how you get low latency — the standard compromise is to use partials for interface feedback and endpointing hints, and finals for decisions.

**Drawbacks and failure modes.**

- **Accents.** Word error rate varies enormously across speaker populations. A model reporting 5% WER on its benchmark may be at 25% on your actual callers.
- **Names and rare words.** Indian names, product names, addresses. Mitigated with keyword boosting or a custom vocabulary — worth doing, and often forgotten.
- **Numbers.** "double two five" and "triple eight" are common spoken forms that generic models transcribe literally.
- **Code-switching.** Hinglish — "mera balance check karna hai" — breaks models trained on one language. Genuinely one of the hardest problems for Indian voice products.
- **8 kHz telephony audio** is out of distribution for models trained on clean wideband speech. Use a telephony-tuned model if the vendor offers one.
- **Noise and crosstalk.** Traffic, TV, a second speaker.

**Stack.** Deepgram, Google STT, Azure Speech, AssemblyAI, Whisper (self-hosted, batch-oriented), Sarvam and other India-focused vendors for Indic languages.

**The metric: word error rate.**

```
WER = (substitutions + insertions + deletions) / words spoken
```

Two things to know. It weights all errors equally, but they aren't equal — getting "not" wrong matters far more than "the". And a vendor's published WER was measured on clean read speech; **measure it on your own recordings before believing anything**. The gap is routinely 3–5×.

For a task-oriented bot, **entity error rate** — did we get the account number and the amount right — predicts success far better than overall WER.

## 4 · Endpointing

**The stage that most determines whether a bot feels human.** Endpointing answers: *has the caller finished their turn?*

Get it wrong in one direction and the bot interrupts people mid-sentence. Get it wrong in the other and every exchange has an awkward pause. Both are immediately, viscerally obvious to a caller, and neither is fixable downstream.

### 04a · Silence-based endpointing

**Purpose.** The traditional approach: after VAD reports N milliseconds of silence, declare the turn over.

**Drawbacks — and this is the crux.** It is a **single number trying to serve two incompatible cases**:

```
"my account number is... 4 4 8 ... uh ... 2 1"
                       ↑ 900ms pause — still thinking, NOT done

"I want to cancel."
                    ↑ 300ms pause — clearly done
```

Set the threshold at 700 ms and you cut off anyone who pauses to recall a number. Set it at 1,500 ms and every simple exchange has a 1.5-second dead gap. There is no correct value, because **silence duration is not what distinguishes a finished thought from a pause.**

Additional failures: thinking noises ("ummm") register as speech and reset the timer indefinitely; background noise does the same; and a caller who trails off quietly gets clipped.

### 04b · Semantic / smart-turn endpointing

**Purpose.** Use the *content* of what was said, not just the silence, to decide whether the turn is complete.

**How it works.** A small, fast model classifies the utterance-so-far as complete or incomplete. Two families:

- **Text-based** — run a small classifier over the partial transcript. "I want to cancel my" is obviously unfinished; "I want to cancel my order" is obviously finished. Syntax alone carries a lot of signal.
- **Audio-based** — classify from the acoustics directly, using prosody: pitch falling at the end of a phrase signals completion, level or rising pitch signals continuation. This is how humans actually do it, and it works before the transcript is even available.

In practice: combine them with silence. Short silence plus "sounds complete" ends the turn quickly; short silence plus "sounds incomplete" keeps waiting. You get fast turns where the caller is done and patience where they aren't.

**The payoff.** You can run a much shorter silence threshold without cutting people off, because the model — not the clock — is deciding. That's several hundred milliseconds off every turn, which is the single largest latency win available in a voice pipeline.

It also cuts **false barge-ins**: a mid-sentence pause no longer looks like a completed turn, so the bot stops jumping in.

**Drawbacks.**

- Another model in the hot path — it must run in a few milliseconds or it eats the latency it saves.
- Text-based versions inherit ASR errors and depend on partial transcripts arriving fast.
- Trained mostly on English; prosody and syntax cues differ across languages, so gains may not transfer to Hindi or Bengali without evaluation.
- Confidently wrong on unusual phrasings — a trailing "so..." that *is* the end of a turn.

**How to evaluate endpointing honestly.** Two numbers on real recorded calls, and you need both because they trade off:

- **Cut-off rate** — how often the bot started while the caller was still speaking.
- **Turn latency** — silence between the caller's last word and the bot's first sound.

Plot one against the other as you vary the threshold. That curve is the honest picture; a single number for either is meaningless without the other.

## 5 · Normalising for meaning

### 05 · Inverse text normalisation and cleanup

**Purpose.** ASR gives you spoken forms. Downstream systems want written forms.

```
"my number is four four eight two one zero"
   → "my number is 448210"

"i'll pay two thousand five hundred rupees"
   → "I'll pay ₹2500"

"call me on the twenty third of march"
   → "call me on 2026-03-23"
```

This is **inverse text normalisation (ITN)**, and it's the difference between an extractable value and a string of words.

**Also here: disfluency handling.** "um, so like, I want, no wait, I need to cancel" → "I need to cancel". Removing filler and honouring self-corrections.

**Drawbacks.**

- **Ambiguity.** "two thousand five hundred" is 2500, but "twenty five hundred" is also 2500 and "two thousand, five hundred" might be two separate figures. Rules need care.
- **Over-normalising loses information.** If someone says "four four eight" and you write "448", you've discarded that they grouped the digits — which sometimes matters for verification.
- **Self-correction is genuinely hard.** "no wait" is a strong signal; many corrections have no marker at all.
- Locale-specific: Indian numbering (lakh, crore), date order, currency.

**Stack.** Many ASR vendors do ITN for you — check, because doing it twice is worse than not doing it. Otherwise rules plus a small model, or fold it into the LLM prompt.

## 6 · NLU, the classical way

**The two questions NLU answers.** **Intent** — what does the caller want? A classification into a fixed set.

**Slots / entities** — what are the parameters? A sequence-labelling problem.

```
"I want to cancel my order 4471"

intent: cancel_order        (confidence 0.94)
slots:  order_id = "4471"
```

### 06 · Intent classification + slot filling

**How it works.** **Intent**: a text classifier. Historically TF-IDF plus an SVM; now a fine-tuned BERT-family encoder. Fast (single-digit milliseconds), deterministic, cheap.

**Slots**: *BIO tagging* — label each token as Beginning, Inside, or Outside of an entity. Worth knowing the scheme by name:

```
  I    want  to   cancel order  4471
  O     O     O     O      O    B-ORDER_ID

  book a  flight to  new    delhi  tomorrow
   O  O     O    O  B-CITY I-CITY  B-DATE
```

**Why it's still the right choice sometimes.**

- **Fast and cheap** — 10 ms and effectively free, versus hundreds of milliseconds and real cost for an LLM.
- **Deterministic** — same input, same output, always. Testable in the ordinary way.
- **Calibrated confidence** — a real probability you can threshold on to trigger a clarification.
- **Constrained** — it cannot invent an intent that isn't in the list.

**Drawbacks.**

- **Needs labelled training data per intent** — typically dozens to hundreds of example phrasings each. Adding an intent is a data-collection project, not a config change.
- **Closed set.** Anything outside the defined intents falls to a catch-all, and real callers are endlessly out-of-scope.
- **Brittle to paraphrase** outside the training distribution.
- **One intent per utterance.** "Cancel my order and update my address" is two intents and the classifier picks one.
- **Multiplies by language.** Every intent, every language, its own labelled data.

**Stack.** Rasa (open source, self-hosted), Dialogflow CX, Azure CLU, or a fine-tuned BERT you own.

## 7 · NLU with an LLM

### 07 · Prompted understanding

**Purpose.** Replace the classifier and the tagger with a single prompted model returning a structured object.

```json
{
  "intent":     "cancel_order",
  "order_id":   "4471",
  "sentiment":  "frustrated",
  "confidence": "high"
}
```

**What you gain.**

- **No training data.** Describe the intents in the prompt and it works. Adding one is an edit.
- **Handles the long tail** — paraphrase, unusual phrasing, compound requests, code-switching.
- **Multiple intents at once**, naturally.
- **Uses conversation context** to resolve "the other one".
- **Multilingual for free**, largely.

**Drawbacks — all of them real.**

- **Latency.** Hundreds of milliseconds against ten. In a 1.5-second budget that is a large fraction.
- **Cost per turn**, on every turn, forever.
- **Non-deterministic.** The same utterance can classify differently. Set temperature to zero and it's *mostly* stable.
- **Hallucinated slots.** It will happily return an order ID that was never mentioned. *Always validate extracted values against the transcript or the database.*
- **No calibrated confidence.** Asking the model how confident it is gives you a number that isn't a probability.
- **Prompt injection** — the caller's words are in your prompt.

**Making it reliable.** Use the provider's structured-output or tool-calling mode rather than parsing free text — the schema is enforced at decode time, so you cannot get invalid JSON. Constrain enums to your intent list. Validate every extracted value before acting on it.

**The hybrid, which is what mature systems actually run.**

```
utterance
    │
    ▼
 fast classifier (10ms)
    │
 confident?  ──yes──►  handle it directly, no LLM
    │
   no
    ▼
 LLM (300ms) for the ambiguous tail
```

The common cases — which are most cases — go through the cheap deterministic path. The long tail gets the expensive flexible one. You get most of the LLM's coverage at a fraction of the average latency and cost.

**This is a strong thing to propose in an interview**, because it shows you're optimising the system rather than picking a favourite technology.

## 8 · Dialogue state tracking

### 08 · What we know so far

**Purpose.** A conversation is not a sequence of independent utterances. The state is everything accumulated: which slots are filled, what's been confirmed, what the caller already refused, where we are in the flow.

```json
{
  "intent":       "book_appointment",
  "slots":        { "date": "2026-03-23",
                    "time": null,
                    "branch": "Koramangala" },
  "confirmed":    ["date"],
  "declined":     ["email_reminder"],
  "turn_count":   4,
  "asked_for_time_times": 2
}
```

**Why it's a named stage rather than an implementation detail.** It's what makes "and the other one?" answerable, what stops the bot asking the same question three times, and what lets a call resume after a transfer.

**Drawbacks and difficulties.**

- **Corrections.** "Actually make it Thursday" must overwrite, not append. Getting this wrong produces a bot that books the wrong day while sounding confident.
- **Partial confirmation.** "Yes, but change the branch" confirms and modifies in one utterance.
- **Growing history.** If the state is "the whole transcript", it grows unboundedly — cost, latency and lost-in-the-middle problems all follow.
- **Where does it live?** In memory means it dies with the process. That's fine for a single call and useless for anything resumable.

**Stack.** Classically a hand-written state object. In an agent framework, LangGraph's typed state with a checkpointer. In this codebase, the flow's module state plus what's persisted per interaction.

## 9 · Dialogue policy

**The decision: given the state, what do we do next?** Ask for a missing slot? Confirm something? Call an API? Transfer to a human? End the call?

This is where a voice bot's *character* lives, and there are three genuinely different approaches.

### 09a · Rule-based flows

**Purpose.** An explicit graph of modules and edges. In this state, with these slots filled, go here. The dominant approach in production, including in this codebase.

**Strengths.**

- **Predictable.** You can enumerate what the bot will do. For regulated industries this isn't a nice-to-have — a compliance team can review a flow chart.
- **Debuggable.** Any behaviour traces to a specific edge.
- **Editable by non-engineers** through a flow builder.
- **Fast** — no model call to decide the next step.

**Drawbacks.**

- **Rigid.** Anything the designer didn't anticipate falls through to a fallback.
- **Combinatorial growth.** Every new condition multiplies paths; large flows become genuinely unmaintainable.
- **Handles digression badly.** "Wait, first tell me my balance" mid-booking requires explicit design at every node, so it usually isn't handled.

### 09b · Learned policy

**Purpose.** Learn the next action from data — supervised on human transcripts, or reinforcement learning against a task-success reward.

**Drawbacks.** Needs large volumes of dialogue data. RL in dialogue is notoriously unstable and needs a simulator, since you cannot explore on real customers. And it's unpredictable in exactly the way regulated deployments cannot accept. **Academically important, rare in production.**

### 09c · LLM as the policy

**Purpose.** Give the model the state, the available tools and the goal, and let it decide.

**Strengths.** Handles digression, ambiguity and the unanticipated gracefully. Feels far more natural. No flow to maintain.

**Drawbacks.**

- **Unpredictable.** It may skip a required disclosure or a verification step. In a regulated call that's not a quality issue, it's a legal one.
- **Latency and cost** on every turn.
- **Prompt injection** from the caller.
- **Hard to guarantee anything** — and voice bots frequently have things that must be guaranteed.

**The pattern that wins in practice.** **A flow for the spine, an LLM for the flesh.**

The flow guarantees the required steps happen in the required order — verification, disclosures, confirmation. Within a node, the LLM handles phrasing, digression, clarification and the messy human parts.

You get the compliance guarantees of a graph and most of the naturalness of an agent. This is essentially the same argument as graph-versus-loop for agents, and it generalises: *structure where correctness is required, flexibility where it isn't.*

## 10 · Tools and business logic

### 10 · Doing the actual thing

**Purpose.** Look up the order, take the payment, book the slot. Without this the bot is an expensive FAQ.

**Drawbacks and hazards.**

- **Latency is now someone else's problem.** A 3-second CRM call is 3 seconds of silence on a live phone line. You need a filler utterance ("let me check that for you") and a timeout — and the filler has to start *before* you know how slow the call will be.
- **Failures need a spoken fallback.** An API 500 must become a sentence, not an exception.
- **Idempotency.** The caller says "yes" twice, or a retry fires. Charging twice is unacceptable in a way that most software failures aren't.
- **Validate everything the model extracted** before acting. An LLM-extracted account number must be checked against the database, never trusted.

## 11 · Natural language generation

### 11a · Templates

**Purpose.** `"Your order {order_id} has been cancelled."` Fill in the values.

**Strengths.** Completely predictable. Legally reviewable. Instant — no model call. Trivially translatable. For anything that must be said exactly — disclosures, confirmations, amounts — this is the only responsible choice.

**Drawbacks.** Robotic and repetitive. Combinatorially explosive when conditions multiply. Bad at acknowledging what the caller actually said.

### 11b · LLM generation

**Purpose.** Have the model write the reply, given the state and the goal.

**Strengths.** Natural, varied, responsive to tone. Can acknowledge frustration, handle the unexpected, and vary phrasing so a repeated question doesn't sound identical.

**Drawbacks.**

- **It can say anything.** Including wrong amounts, invented policies and commitments you can't honour. In a financial or medical call this is the dominant risk.
- **Length is unpredictable**, and long replies are slow to speak and easy to interrupt.
- **Latency and cost per turn.**

**The mitigation.** **Never let the model generate a number, a policy statement or a legal disclosure.** Inject those as fixed strings and let the model write only the surrounding language. You keep naturalness and lose the category of error that actually hurts.

## 12 · Normalising for speech

**The most underrated stage in the entire pipeline.** Text that reads perfectly can sound absurd. This stage — **text normalisation for TTS**, the mirror image of stage 5 — converts written forms into what a person would actually say.

### 12 · Written → spoken

```
"₹2,500.50"      → "two thousand five hundred rupees and fifty paise"
"Dr. Rao"        → "doctor Rao"
"23/03/2026"     → "the twenty third of March twenty twenty six"
"+91 98765..."   → digits, grouped, with pauses
"ETA 15 min"     → "estimated arrival, fifteen minutes"
"#4471"          → "number four four seven one"
"IIT-D"          → "I I T Delhi"
```

**Drawbacks and difficulties.**

- **Deeply ambiguous.** "St." is Street or Saint. "2/3" is a date, a fraction or a ratio. "Dr." is Doctor or Drive. Only context decides, and the context isn't always available.
- **Locale-specific.** Indian numbering (lakh, crore), date order, currency subunits, phone grouping conventions.
- **Reading digits aloud has conventions.** Account numbers are read in groups with pauses, not as one huge number. "448210" should not become "four hundred forty-eight thousand two hundred and ten".
- **Modern neural TTS does some of this implicitly**, inconsistently, and in a way you cannot inspect. Doing it yourself is more code and far more predictable.

**Stack.** Rules plus locale libraries, and **SSML** where the TTS supports it — explicit markup for how to say things:

```
<say-as interpret-as="digits">448210</say-as>
<break time="300ms"/>
<say-as interpret-as="currency">INR2500</say-as>
```

SSML support varies by vendor and several neural TTS engines ignore much of it — verify rather than assume.

## 13 · Speech synthesis

### 13 · TTS

**Three generations, in one paragraph each.** **Concatenative** — record a voice actor saying thousands of fragments, then stitch. Sounds like the speaker when it works; audibly seamed at the joins, and adding a new phrase means a new recording session.

**Parametric** — model the vocal tract and synthesise. Flexible and small; distinctly robotic.

**Neural** — a model maps text to audio directly. Nearly indistinguishable from human, controllable in style, and it can clone a voice from minutes of audio. Costs GPU compute, which is why TTS is often the largest line item in a voice bot's bill.

**Streaming matters more here than almost anywhere.** A 12-second reply takes real time to synthesise in full. Streaming TTS emits audio as it generates, so playback starts in a couple of hundred milliseconds.

And you don't wait for the LLM to finish either — you send the **first complete sentence** to TTS while the model is still writing the third. Not the first token: TTS needs a coherent phrase to get the prosody right, and a sentence is the natural unit. This is what a sentence aggregator in a voice pipeline is for.

**Drawbacks and failure modes.**

- **Time to first byte** is the number that matters, and it varies enormously between vendors — well over half a second for some, under 150 ms for others. On a phone call that difference is the whole perceived quality gap.
- **Wrong prosody.** A statement read as a question; emphasis on the wrong word. Hard to control, and neural models sometimes ignore SSML hints.
- **Mispronunciation** of names, places and domain terms. Custom pronunciation dictionaries help where supported.
- **Code-switching within a sentence** — an English word inside a Hindi sentence is often read with the wrong phonology.
- **Cost.** Per character or per second, and it adds up fast at volume. This is what makes self-hosting worth considering.
- **Cutting off cleanly on barge-in** is a real engineering problem — see the next stage.

**Stack.** Cartesia, ElevenLabs, Azure, Google, Sarvam and Smallest for Indic languages; Orpheus and similar open models when self-hosting.

## 14 · Barge-in

### 14 · Handling interruption

**Purpose.** People interrupt. A bot that keeps talking over them is unusable, so when VAD detects the caller speaking during playback, everything must stop.

**What "stop" actually involves.**

1. Stop playing buffered audio — including audio already handed to the transport.
2. Cancel the in-flight TTS request.
3. Cancel the in-flight LLM generation.
4. Truncate the conversation history to what was *actually heard*, not what was generated.
5. Start listening.

**Drawbacks and hard parts.**

- **Step 4 is the subtle one and it's usually wrong.** If the bot generated a 30-word sentence and the caller interrupted after 6 words, the history must record 6 words. Record all 30 and the bot believes it said things the caller never heard, and every later turn is built on a false premise.
- **False barge-ins.** A cough, a background TV, an acknowledging "mm-hmm" — the bot stops for nothing and the conversation stutters. Tuning VAD sensitivity against this is a genuine trade-off with no clean answer.
- **Buffered audio is already downstream.** Depending on the transport, up to a second of audio may be queued past the point you control, and it will keep playing after you've stopped generating.
- **Race conditions.** Cancelled tasks that complete anyway and signal state belonging to the *next* utterance are a rich source of intermittent bugs — the kind that only appear on live calls.

## 15 · After the call

### 15 · Offline NLP

**Purpose.** The call is over and the latency budget is gone. Now you can afford expensive models on the full transcript.

- **Summarisation** — a paragraph for the CRM so a human doesn't read the transcript.
- **Disposition classification** — resolved, escalated, callback, wrong number.
- **Sentiment and frustration detection** — over the arc of the call, not per turn.
- **Compliance checking** — were the required disclosures actually said? This is often the reason the whole subsystem exists.
- **QA scoring** — automated review against a rubric, replacing sampling a small percentage of calls by hand.
- **Topic clustering** — what are people calling about that we don't handle? This is the roadmap.

**Drawbacks.** Runs on the ASR transcript, so it inherits every ASR error — and compliance conclusions drawn from a flawed transcript can be confidently wrong in a way that matters. Cost scales with call volume. And a full transcript is sensitive data with retention and consent obligations attached.

## The latency budget

```
caller stops speaking
  │
  ├─ endpointing decision            300 – 800 ms   ◄ biggest lever
  ├─ final ASR transcript             50 – 200 ms
  ├─ NLU  (classifier 10ms / LLM 300ms)
  ├─ policy decision                   0 – 200 ms
  ├─ tool call (if any)              100 – 3000 ms  ◄ needs a filler
  ├─ LLM first token                 200 – 800 ms
  ├─ first sentence complete         100 – 400 ms
  ├─ TTS time to first byte          100 – 700 ms   ◄ huge vendor variance
  └─ network to caller                20 – 100 ms
                                     ─────────────
caller hears audio          typically 900 – 2500 ms
```

**Where the time actually is, and what to do about it.** **Endpointing is the largest single lever**, and it's the one most teams never touch. Semantic turn detection lets you cut several hundred milliseconds off *every turn* without cutting people off. Nothing else available is that large.

**Streaming everywhere is not an optimisation, it's the architecture.** ASR streams partials. The LLM streams tokens. TTS starts at the first sentence, not the last. Done properly, stages overlap rather than queue, and the total is far less than the sum.

**Tool calls need a spoken filler.** You cannot make the CRM faster, so cover it — and start the filler before the call returns, not after it's slow.

**Measure percentiles, not means.** A p50 of 900 ms with a p95 of 4 seconds is a bad experience that a mean of 1.1 s completely hides.

## Metrics, stage by stage

| Stage | Metric | Watch out for |
|---|---|---|
| VAD | False trigger rate; missed-speech rate | Both move together — report both |
| ASR | WER; **entity error rate** | Vendor WER is measured on clean read speech |
| Endpointing | Cut-off rate vs turn latency | Meaningless as a single number |
| NLU | Intent accuracy; slot F1 | Measure on *ASR output*, not clean text |
| Policy | Task completion rate | The metric that actually matters |
| TTS | Time to first byte; MOS | TTFB varies hugely between vendors |
| Barge-in | False barge-in rate; stop latency | Only visible on live calls |
| End to end | Containment; CSAT; turn latency p50/p95 | Containment is gameable — pair with reopen rate |

**The single most important measurement discipline.** **Evaluate NLU on real ASR transcripts, never on clean typed text.**

An intent classifier at 96% on typed test data can be at 78% on what the ASR actually produces, and the gap is invisible until production. Building your NLU test set from real transcripts — errors and all — is the difference between a system that works in a demo and one that works on a phone.

## Where it breaks

**The Indian-language problems specifically.**

- **Code-switching.** "Mera balance check karna hai" mixes Hindi and English in one sentence. Most ASR models are trained on one language and degrade badly. Some vendors handle it; test before assuming.
- **Tokenizer cost.** Devanagari and Bengali cost several times more tokens per sentence than English — real money, real latency, and a much smaller effective context window.
- **Names.** Indian names are under-represented in pretrained ASR and NER. Custom vocabularies and boosting help; nothing fixes it entirely.
- **Numbering.** Lakh and crore need explicit handling in both directions — understanding and speaking.
- **Regional accent variation** within a single language is large, and a model trained on one region's speakers can be much worse on another's.
- **Less training data** across the board, so every model in the chain is weaker than its English equivalent. Budget for it rather than being surprised.

**The universal ones.**

- **Numbers spoken aloud.** "Double two", "triple eight", "oh" for zero. Common, and generically transcribed wrong.
- **Spelling out.** "R for Robert, O for Orange" — a distinct mode most systems don't recognise.
- **Negation surviving the whole pipeline.** "I don't want to cancel" and "I want to cancel" differ by one word that every stage is prone to dropping.
- **Elderly and child speakers**, and anyone with a speech difference. Systematically worse, and rarely measured.
- **Long silences that aren't the end of a turn** — someone finding a document, reading a number off a card.

## How to test, and where to breakpoint

**1 · Replay real recorded audio through the whole pipeline.** The single most valuable test asset. Keep a library of real calls — accents, noise, code-switching, awkward pauses — and run the pipeline against them on every change. Assert on the transcript, the intent, the slots and the final action.

**2 · Test each stage against the previous stage's *real* output.** Feed the NLU actual ASR transcripts. Feed the TTS normaliser actual LLM output. Testing each stage on idealised input is how a pipeline passes every test and fails every call.

**3 · Synthesise adversarial audio.** Use TTS to generate test utterances at different accents and speeds, mix in recorded background noise at known levels, and measure WER degradation as a curve. Cheap, repeatable, and it finds the cliff before your callers do.

**4 · Test barge-in explicitly, and the history truncation especially.** Script an interruption at a known point. Assert that audio stopped, that generation was cancelled, and — most importantly — that the conversation history records only what was actually heard. This is the bug that hides for months.

**5 · Latency as a distribution, on real calls.** Instrument every stage boundary and record p50, p95 and p99 separately. Averages hide the calls that make people hang up.

**Where to breakpoint.**

- **The final ASR transcript** — First thing to check on any "it misunderstood me" report. Usually the answer is there and you can stop.
- **The endpointing decision, with its inputs** — What silence duration, what partial transcript, what the classifier said. Cut-offs and long pauses both resolve here.
- **NLU input and output together** — Wrong intent from a good transcript is an NLU problem; wrong intent from a bad transcript is an ASR problem. Different fixes.
- **The dialogue state after every turn** — Most "the bot forgot" and "the bot asked twice" bugs are visible as wrong state.
- **The text handed to TTS, after normalisation** — Not the text the LLM produced — the text after normalising. Almost every "it said that weirdly" traces to here.
- **The truncated history after a barge-in** — Compare what was generated against what was played.

## Interview answers

**Q: Walk me through what happens when someone speaks to your voice bot.**

"Audio arrives from the carrier over SIP and RTP and gets decoded into PCM frames. A VAD tells us whether there's speech in each frame — that drives barge-in and feeds endpointing. Streaming ASR turns audio into text, emitting unstable partials and then a final.

Endpointing decides the turn is over — not on silence duration alone, ideally, but on whether the utterance sounds complete. Then we normalise: spoken numbers into digits, strip disfluency.

NLU extracts intent and slots. We update dialogue state — what's filled, what's confirmed. The policy decides the next action, calls whatever API is needed, and we compose a reply. Then normalise the other way, written to spoken, and stream it to TTS, starting at the first complete sentence rather than waiting for the whole reply.

Throughout, VAD is watching for the caller interrupting, and if they do we stop playback, cancel the TTS and LLM, and truncate the history to what was actually heard.

The two properties that shape all of it: errors compound down the chain, and every stage's latency adds up — which is why everything streams."

**Q: How do you know when the user has finished speaking?**

The best question in this area — answer it well.

"Naively, silence duration: VAD reports N milliseconds of quiet and you call the turn. The problem is that one number has to serve two incompatible cases. Someone reading an account number pauses for a second mid-utterance; someone saying 'cancel it' is done in 300 milliseconds. Set the threshold long and every simple turn has a dead gap; set it short and you cut people off. Silence duration just isn't what distinguishes a finished thought from a pause.

The better approach is semantic endpointing — a small fast model that classifies whether the utterance is complete, from the partial transcript, from prosody, or both. Falling pitch and a syntactically complete sentence mean done; level pitch and a dangling preposition mean wait.

Combined with a short silence timer, you get fast turns when they're finished and patience when they're not. It's the single biggest latency lever in a voice pipeline — several hundred milliseconds off every turn — and it also cuts false barge-ins, because a mid-sentence pause no longer looks like a completed turn.

The caveats: it's another model in the hot path so it has to be genuinely fast, and most of them are trained on English, so I'd evaluate before assuming the gains transfer to Hindi or Bengali."

**Q: Intent classifier or LLM for NLU?**

"Both, routed by confidence.

A fine-tuned classifier runs in about ten milliseconds, costs nothing, is deterministic, gives calibrated confidence, and cannot invent an intent that isn't in the list. That's genuinely valuable for the common cases, which are most cases.

What it can't do is handle the tail — paraphrase outside its training data, compound requests, code-switching, anything out of scope. And every new intent is a labelling project rather than a config change.

So: run the classifier first, and if it's confident, act. If it isn't, escalate that turn to an LLM with structured output. You get the LLM's coverage at a fraction of the average latency and cost.

One thing I'd insist on either way — validate extracted slots against the source. An LLM will happily return an order number that was never said."

**Q: Why not let an LLM run the whole conversation?**

"For an unregulated use case you might. For anything with compliance requirements, no — because you can't guarantee anything.

If a disclosure legally has to be read before a payment is taken, 'the model usually does it' is not an acceptable answer. A prompt instruction is a request; a flow edge is a guarantee.

What I'd actually build is a flow for the spine and an LLM for the flesh. The flow enforces the required steps in the required order — verification, disclosure, confirmation. Inside each node, the LLM handles phrasing, digressions and clarification. You get the auditability of a state machine and most of the naturalness of an agent.

The secondary reasons are latency and cost — an LLM deciding every turn adds hundreds of milliseconds to a budget that's already tight — and prompt injection, since the caller's words go into your prompt."

**Q: Your bot is too slow. Where do you look?**

"Measure per stage first — p50 and p95 separately, because averages hide the calls that make people hang up. Then in this order:

Endpointing, because it's usually the biggest single number and the one nobody has touched. If it's on a fixed 1-second silence timer, semantic turn detection can take several hundred milliseconds off every turn.

Then check whether the pipeline is genuinely streaming or just structured to look like it. Is TTS starting at the first sentence or waiting for the whole reply? Is the LLM streaming? Stages should overlap, not queue.

Then TTS time-to-first-byte — the variance between vendors is enormous, well over half a second in some cases, and it's a swap rather than a rebuild.

Then tool calls — those you usually can't speed up, so cover them with a filler utterance that starts before you know the call is slow.

And prompt size, since prefill time scales with it — a bloated system prompt costs you on every single turn."

**Q: What's the difference between classical NLP and what we do now?**

"Classical NLP was a chain of explicit steps — normalise, tokenise, stem, POS-tag, parse, then hand-designed features into a classifier. Each stage was a separate model with its own labelled data, and errors compounded down the chain.

The change wasn't really transformers, it was **transfer learning**. Pretrain one model on huge amounts of unlabelled text so it learns the language, then adapt it with a small labelled set. Suddenly you didn't need a dataset per task, and the intermediate stages became unnecessary because the model learnt syntax implicitly.

What I'd add is that all three eras are still in production, often in the same system. Regex for phone numbers, BM25 in retrieval, a BERT classifier for fast intent routing, an LLM for the open-ended turns. Each is the right tool somewhere, and 'we use LLMs for everything' usually means nobody measured."

## Glossary

- **NLP** — Natural language processing — computers working with human language.
- **NLU / NLG** — Understanding input / generating output. The two halves.
- **Tokenisation** — Splitting text into units.
- **Stemming / lemmatisation** — Reducing words to a base form, crudely / properly.
- **Stop words** — Common words historically removed. Usually harmful now.
- **POS tagging** — Labelling each word's part of speech.
- **NER** — Finding and typing entities — names, dates, amounts.
- **BIO tagging** — Begin/Inside/Outside labels for multi-token entities.
- **Coreference** — Working out what pronouns refer to.
- **Bag of words** — Word counts, order discarded.
- **TF-IDF** — Weight words by local frequency and global rarity.
- **Word2Vec / GloVe** — Static word embeddings — one vector per word.
- **Contextual embedding** — A different vector per occurrence. BERT.
- **Transfer learning** — Pretrain broadly, adapt narrowly. The pivot of modern NLP.
- **PCM** — Raw audio samples.
- **VAD** — Voice activity detection — is this speech?
- **ASR / STT** — Speech recognition — audio to text.
- **WER** — Word error rate. Substitutions + insertions + deletions over words spoken.
- **Partial / final** — Provisional vs settled streaming transcript.
- **Endpointing** — Deciding the caller's turn is over.
- **Semantic turn detection** — Endpointing from content and prosody, not just silence.
- **ITN** — Inverse text normalisation — spoken forms to written.
- **Text normalisation for TTS** — Written forms to speakable ones. The mirror image.
- **Disfluency** — Fillers, false starts, self-corrections.
- **Intent** — What the caller wants, as a classification.
- **Slot / entity** — A parameter the intent needs.
- **Dialogue state** — Everything known so far in the conversation.
- **Dialogue policy** — What to do next, given the state.
- **SSML** — Markup telling TTS how to say something.
- **TTS** — Text to speech.
- **TTFB** — Time to first byte — how fast audio starts.
- **Barge-in** — The caller interrupting the bot.
- **Containment / deflection** — Calls handled without a human.
- **MOS** — Mean opinion score — human-rated audio quality.

---

Companion documents: inside a language model · retrieval end to end · the LangChain stack · voice runtime · pipecat upgrade · telephony · CI/CD and containers · distributed systems · Vasco stack.

Latency figures are representative ranges, not measurements of any specific system — measure your own.
