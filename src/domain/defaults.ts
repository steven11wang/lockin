import type { Activity, Emotion, Preferences } from './models';

export const DEFAULT_ACTIVITIES: readonly Activity[] = [
  {
    id: 'activity-study',
    name: 'Study',
    color: '#5B5BD6',
    sortOrder: 1,
    quickSlot: 1,
    archivedAt: null,
  },
  {
    id: 'activity-exercise',
    name: 'Exercise',
    color: '#2E9D68',
    sortOrder: 2,
    quickSlot: 2,
    archivedAt: null,
  },
  {
    id: 'activity-work',
    name: 'Work',
    color: '#2F6FED',
    sortOrder: 3,
    quickSlot: 3,
    archivedAt: null,
  },
  {
    id: 'activity-social',
    name: 'Social',
    color: '#C85A9E',
    sortOrder: 4,
    quickSlot: 4,
    archivedAt: null,
  },
  {
    id: 'activity-eat',
    name: 'Eat',
    color: '#D9822B',
    sortOrder: 5,
    quickSlot: null,
    archivedAt: null,
  },
  {
    id: 'activity-doom-scrolling',
    name: 'Doom Scrolling',
    color: '#7C5CFC',
    sortOrder: 6,
    quickSlot: null,
    archivedAt: null,
  },
  {
    id: 'activity-doing-nothing',
    name: 'Doing Nothing',
    color: '#6B7280',
    sortOrder: 7,
    quickSlot: null,
    archivedAt: null,
  },
];

export const DEFAULT_EMOTIONS: readonly Emotion[] = [
  { id: 'emotion-happy', name: 'Happy', color: '#F2B84B', sortOrder: 1, archivedAt: null },
  { id: 'emotion-calm', name: 'Calm', color: '#65BFA6', sortOrder: 2, archivedAt: null },
  { id: 'emotion-focused', name: 'Focused', color: '#5B8DEF', sortOrder: 3, archivedAt: null },
  { id: 'emotion-energized', name: 'Energized', color: '#EF8B4B', sortOrder: 4, archivedAt: null },
  { id: 'emotion-tired', name: 'Tired', color: '#8A94A6', sortOrder: 5, archivedAt: null },
  { id: 'emotion-anxious', name: 'Anxious', color: '#A879D9', sortOrder: 6, archivedAt: null },
  { id: 'emotion-frustrated', name: 'Frustrated', color: '#D95C5C', sortOrder: 7, archivedAt: null },
  { id: 'emotion-sad', name: 'Sad', color: '#547AA5', sortOrder: 8, archivedAt: null },
];

export const DEFAULT_PREFERENCES: Preferences = {
  schemaVersion: 1,
  weekStartsOn: 1,
  hourCycle: 12,
  reducedMotion: false,
  lastPausedActivityId: null,
};
