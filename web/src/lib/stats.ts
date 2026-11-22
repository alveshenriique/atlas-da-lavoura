// The Student t distribution, for the two one-sided tests of the drought reading
// (lib/drought.ts). The cumulative distribution comes from the regularized incomplete beta
// function, evaluated by its continued fraction (Lentz's method, as in Numerical Recipes,
// section 6.4). tests/stats.test.ts checks it against reference values (scipy.stats.t).

const EPSILON = 1e-14;
const TINY = 1e-300;

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9), accurate to about 15 digits for x > 0.
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] ?? 0;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] ?? 0) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  // The continued fraction converges fast below the mean; above it, use the symmetry.
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(a, b, x)) / a;
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** P(T ≤ t) for Student's t with `df` degrees of freedom (df may be fractional, as Welch's). */
export function studentCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/**
 * One-sided p-value that a correlation r over n pairs is greater than zero
 * (t = r √(n − 2) / √(1 − r²), n − 2 degrees of freedom).
 */
export function correlationPValue(r: number, n: number): number {
  if (n < 3) return 1;
  if (r >= 1) return 0;
  const t = (r * Math.sqrt(n - 2)) / Math.sqrt(1 - r * r);
  return 1 - studentCdf(t, n - 2);
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: readonly number[]) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};

/**
 * One-sided p-value of Welch's t test that the mean of `a` is less than the mean of `b`
 * (unequal variances, Welch–Satterthwaite degrees of freedom). Needs two values on each side.
 */
export function welchLessPValue(a: readonly number[], b: readonly number[]): number {
  if (a.length < 2 || b.length < 2) return 1;
  const va = variance(a) / a.length;
  const vb = variance(b) / b.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return mean(a) < mean(b) ? 0 : 1;
  const t = (mean(a) - mean(b)) / se;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return studentCdf(t, df);
}
