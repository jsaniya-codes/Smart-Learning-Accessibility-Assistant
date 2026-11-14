import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFallbackSearchQuery,
  classifyYouTubeApiError,
  mapLanguageCode,
  normalizeYoutubeApiKey,
  parseDurationSeconds,
  parseIso8601Duration,
  resolveGeminiTextModel,
  sanitizeYouTubeErrorText,
  scoreAndFilterCandidates,
  SlidingWindowRateLimiter,
  type YouTubeCandidateVideo,
} from './youtube';

test('parseIso8601Duration and parseDurationSeconds handle standard and hour-long YouTube durations', () => {
  assert.equal(parseDurationSeconds('PT8M42S'), 522);
  assert.equal(parseIso8601Duration('PT8M42S'), '8:42');

  assert.equal(parseDurationSeconds('PT1H2M5S'), 3725);
  assert.equal(parseIso8601Duration('PT1H2M5S'), '1:02:05');

  assert.equal(parseIso8601Duration('PT45S'), '0:45');
  assert.equal(parseIso8601Duration('PT12M'), '12:00');
  assert.equal(parseIso8601Duration(''), '');
  assert.equal(parseIso8601Duration(undefined), '');
});

test('mapLanguageCode maps common student language choices to ISO 639-1 codes', () => {
  assert.equal(mapLanguageCode('English'), 'en');
  assert.equal(mapLanguageCode('Spanish'), 'es');
  assert.equal(mapLanguageCode('Hindi'), 'hi');
  assert.equal(mapLanguageCode('French'), 'fr');
  assert.equal(mapLanguageCode('Japanese'), 'ja');
  assert.equal(mapLanguageCode('UnknownLang'), 'en');
});

test('buildFallbackSearchQuery extracts topic, keywords, and level-aware educational query', () => {
  const analysis = buildFallbackSearchQuery({
    topicOrText:
      'Photosynthesis converts light energy into chemical energy inside plant chloroplasts using chlorophyll.',
    learningLevel: 'Beginner',
    preferredLanguage: 'English',
  });

  assert.ok(analysis.keywords.length > 0);
  assert.match(analysis.searchQuery.toLowerCase(), /beginner|tutorial/);

  const spanishCustom = buildFallbackSearchQuery({
    topicOrText: '',
    customTopic: 'Quantum Entanglement',
    learningLevel: 'Advanced',
    preferredLanguage: 'Spanish',
  });
  assert.equal(spanishCustom.topic, 'Quantum Entanglement');
  assert.match(spanishCustom.searchQuery.toLowerCase(), /quantum entanglement/);
  assert.match(spanishCustom.searchQuery.toLowerCase(), /spanish/);
});

test('scoreAndFilterCandidates ranks educational lessons above clickbait Shorts and caps at 5 results', () => {
  const candidates: YouTubeCandidateVideo[] = [
    {
      videoId: 'spam1',
      title: 'TOP 10 SHOCKING Photosynthesis PRANK Gone Wrong #shorts',
      description: 'Funny moments reaction memes',
      thumbnailUrl: 'https://i.ytimg.com/vi/spam1/hqdefault.jpg',
      channelName: 'Meme Central',
      durationIso: 'PT35S',
      viewCount: 9_000_000,
      categoryId: '24',
    },
    {
      videoId: 'edu1',
      title: 'Photosynthesis Explained for Beginners | Step-by-Step Visual Lesson',
      description: 'Learn how chloroplasts and chlorophyll turn sunlight into glucose.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu1/hqdefault.jpg',
      channelName: 'Amoeba Sisters',
      durationIso: 'PT8M14S',
      viewCount: 1_200_000,
      categoryId: '27',
    },
    {
      videoId: 'edu2',
      title: 'Cellular Energy & Photosynthesis Crash Course',
      description: 'Complete introduction and tutorial on light reactions and Calvin cycle.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu2/hqdefault.jpg',
      channelName: 'CrashCourse',
      durationIso: 'PT13M15S',
      viewCount: 950_000,
      categoryId: '27',
    },
    {
      videoId: 'edu3',
      title: 'How Chloroplasts Work: Visual Guide',
      description: 'Biology concept explanation for high school students.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu3/hqdefault.jpg',
      channelName: 'Khan Academy',
      durationIso: 'PT6M40S',
      viewCount: 500_000,
      categoryId: '27',
    },
    {
      videoId: 'edu4',
      title: 'Photosynthesis Basics 101',
      description: 'Simple overview of glucose production in plants.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu4/hqdefault.jpg',
      channelName: 'BioTutor',
      durationIso: 'PT5M10S',
      viewCount: 40_000,
      categoryId: '27',
    },
    {
      videoId: 'edu5',
      title: 'Plant Biology Lesson: Light Energy to Chemical Energy',
      description: 'Detailed guide with diagrams.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu5/hqdefault.jpg',
      channelName: 'Science Academy',
      durationIso: 'PT10M02S',
      viewCount: 65_000,
      categoryId: '27',
    },
    {
      videoId: 'edu6',
      title: 'Chlorophyll and Photosynthesis Tutorial',
      description: 'Beginner overview.',
      thumbnailUrl: 'https://i.ytimg.com/vi/edu6/hqdefault.jpg',
      channelName: 'StudyLab',
      durationIso: 'PT4M50S',
      viewCount: 25_000,
      categoryId: '27',
    },
  ];

  const ranked = scoreAndFilterCandidates(candidates, {
    topic: 'Photosynthesis',
    keywords: ['photosynthesis', 'chloroplasts', 'glucose'],
    learningLevel: 'Beginner',
    preferredLanguage: 'English',
  });

  assert.equal(ranked.length, 5);
  assert.ok(!ranked.some((v) => v.videoId === 'spam1'), 'Spam Shorts should be excluded');
  assert.equal(ranked[0]!.videoId, 'edu1');
  assert.equal(ranked[0]!.duration, '8:14');
  assert.equal(ranked[0]!.videoUrl, 'https://www.youtube.com/watch?v=edu1');
  assert.ok(ranked[0]!.recommendationReason.length > 10);
});

test('SlidingWindowRateLimiter blocks excessive bursts and recovers after window expires', () => {
  const limiter = new SlidingWindowRateLimiter(3, 1000);
  assert.equal(limiter.allow('user-a', 100).allowed, true);
  assert.equal(limiter.allow('user-a', 200).allowed, true);
  assert.equal(limiter.allow('user-a', 300).allowed, true);

  const blocked = limiter.allow('user-a', 400);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);

  // Separate user is unaffected
  assert.equal(limiter.allow('user-b', 400).allowed, true);

  // Past 1000ms window
  assert.equal(limiter.allow('user-a', 1200).allowed, true);
});

test('resolveGeminiTextModel rejects token strings and deprecated models and falls back safely', () => {
  assert.equal(resolveGeminiTextModel(undefined), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiTextModel(''), 'gemini-4-hydrogen');
  assert.equal(
    resolveGeminiTextModel('AQ.Ab8RN6KZPqX-cJwy_cGoOum3ABzCkN7qjdDgTxmgNVqUtuFDlw'),
    'gemini-4-hydrogen'
  );
  assert.equal(resolveGeminiTextModel('gemini-1.5-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiTextModel('gemini-2.0-flash'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiTextModel('gemini-4-hydrogen'), 'gemini-4-hydrogen');
  assert.equal(resolveGeminiTextModel('models/gemini-2.5-flash'), 'gemini-2.5-flash');
});

test('normalizeYoutubeApiKey trims whitespace, quotes, env prefix, and rejects placeholders', () => {
  assert.equal(normalizeYoutubeApiKey('  "AIzaTestKey1234567890"  '), 'AIzaTestKey1234567890');
  assert.equal(normalizeYoutubeApiKey("YOUTUBE_API_KEY='AIzaTestKey1234567890'"), 'AIzaTestKey1234567890');
  assert.equal(normalizeYoutubeApiKey('MY_YOUTUBE_DATA_API_V3_KEY'), '');
  assert.equal(normalizeYoutubeApiKey('   '), '');
});

test('classifyYouTubeApiError classifies quota, referrer, disabled API, and redacts secrets', () => {
  const quotaErr = classifyYouTubeApiError(403, {
    error: { errors: [{ reason: 'quotaExceeded' }], message: 'Quota exceeded' },
  });
  assert.equal(quotaErr.status, 429);
  assert.match(quotaErr.message, /quota/i);

  const refererErr = classifyYouTubeApiError(403, {
    error: {
      message: 'Requests from referer <empty> are blocked.',
      details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }],
    },
  });
  assert.equal(refererErr.status, 503);
  assert.match(refererErr.message, /referrer restrictions/i);

  const disabledErr = classifyYouTubeApiError(403, {
    error: {
      message: 'YouTube Data API v3 has not been used in project 123 before or it is disabled.',
      errors: [{ reason: 'accessNotConfigured' }],
    },
  });
  assert.equal(disabledErr.status, 503);
  assert.match(disabledErr.message, /YouTube Data API v3 is not enabled/i);

  const unsupportedCredErr = classifyYouTubeApiError(401, {
    error: {
      message: 'API keys are not supported by this API. Expected OAuth2 access token.',
    },
  });
  assert.equal(unsupportedCredErr.status, 503);
  assert.match(unsupportedCredErr.message, /AIza/i);

  const leaked = sanitizeYouTubeErrorText('Invalid key=AIzaFakeSecretValue123456 in request');
  assert.ok(!leaked.includes('AIzaFakeSecretValue123456'));
});

