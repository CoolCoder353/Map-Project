/** True if `expression` is a recurrence rule rather than a cron expression. */
export declare function isRrule(expression: string): boolean;
/**
 * The first occurrence strictly after `after`, or null when the rule has none: an exhausted COUNT
 * or a passed UNTIL leaves a schedule with nothing left to send.
 *
 * The time zone comes from DTSTART when it names one, and from `tz` otherwise, which is both what
 * RFC 5545 says and what lets a rule written without a DTSTART behave like a cron expression on the
 * same schedule.
 */
export declare function nextOccurrence(expression: string, after: Date, tz: string): Date | null;
/**
 * A walk of the occurrences after `from`, one call at a time, answering null once a finite rule has
 * run out and on every call after that.
 *
 * The rule is built once and the walk closes over it, which is the difference between a preview and
 * a pass: a pass reads a schedule twice and a preview asks for up to a thousand occurrences of one
 * expression, so building per occurrence would spend most of the caller's time budget on the parse.
 * A sparse rule near the budget then loses occurrences it would otherwise have returned, rather
 * than only milliseconds.
 */
export declare function rruleWalker(expression: string, tz: string, from: Date): () => Date | null;
/**
 * Every occurrence in `after` to `until`, the lower bound excluded and the upper included, in order.
 *
 * The whole window rather than the first occurrence in it, because a rule can put two occurrences
 * closer together than the interval between passes: a calendar export pairing an hourly rule with
 * an RDATE seconds before one of its occurrences is the ordinary shape of that. A read answering
 * with a single point leaves the second of the two visible only while no pass lands between them,
 * so it is dropped rather than throttled, and reading backwards from now only moves the loss to
 * the other one.
 */
export declare function occurrencesInWindow(expression: string, after: Date, until: Date, tz: string): Date[];
/**
 * The most recent occurrence in `after` to `until`, the lower bound excluded and the upper
 * included, or null when the range holds none.
 *
 * Read in steps that widen backwards from `until` rather than in one between() over the whole
 * range, because the range a catch-up reads is as wide as the gap it covers: a single between()
 * over three weeks of a per-second rule materializes every occurrence in those three weeks to hand
 * back the one the caller will use. A dense expression answers out of the first step, and a sparse
 * one reaches `after` in a few more, since each step is four times the last.
 *
 * Widening is a guess about density, and a rule that is empty near `until` and dense further back
 * defeats it: the steps over the empty stretch grow until one spans more occurrences than
 * rrule-temporal will generate in a single call, and it throws rather than truncating. A per-second
 * rule whose UNTIL passed a day or more before the gap opened is that shape, and an ordinary one.
 * So a step that overruns is halved and read again, and the width it overran at becomes a ceiling no
 * later step goes back over. A step at the floor that still overruns is the expression rather than
 * the width, and the caller hears about it instead.
 *
 * Narrowing is what the widening costs, and the pass is blocked on it: with the ceiling at the floor
 * the read walks an hour of range per step, so it costs what it searches rather than what it
 * returns. Paying that takes an overrun and a long empty stretch behind it, which is a dense rule
 * that is dense only rarely. `FREQ=SECONDLY;BYMONTHDAY=1` is that shape, and it answers in around
 * 1.3 seconds, bounded by the distance back to the nearest occurrence rather than by the width of
 * the gap, so 30 days and 90 cost the same. A rule already spent when the range opens never
 * overruns, keeps its widening, and answers null in 10ms.
 *
 * Deliberately not rrule-temporal's previous(). That walks backwards from a phase-aligned DTSTART,
 * and an RDATE is an absolute instant rather than a phase, so a rule carrying one answers with the
 * RDATE in place of the rule occurrence that follows it and loses every occurrence in between.
 * between() has no such problem, and it is what the due window has always read.
 */
export declare function latestOccurrenceBefore(expression: string, after: Date, until: Date, tz: string): Date | null;
/**
 * Rejects an expression or time zone no pass could evaluate, so a schedule that cannot be read is
 * reported to the caller rather than to a warning on every later pass.
 */
export declare function assertRrule(expression: string, tz: string): void;
/**
 * Rejects a rule with nothing left to send, which is the one failure a caller of `schedule()`
 * cannot see: the row sits in the table, every pass evaluates it, and no job is ever sent. A spent
 * COUNT and a passed UNTIL both land here.
 *
 * In the schedule's own zone, since that is the one the pass evaluates, and from `from`, which is
 * the clock the pass reads, so a rule expiring inside the skew window is judged the way it will be
 * evaluated rather than the way one process happens to see the time.
 *
 * Separate from assertRrule because a preview makes no such demand: a rule that has finished has an
 * empty list of occurrences left, which is an answer, while a schedule that quietly does nothing
 * forever is not.
 */
export declare function assertRruleSends(expression: string, tz: string, from: Date): void;
//# sourceMappingURL=rrule.d.ts.map