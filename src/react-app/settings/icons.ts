import { Mic, Users, FileText, Calendar, MessageSquare, ChartColumn, Lightbulb, Flag, Star, Headphones, BookOpen, Briefcase, GraduationCap, Heart, CircleCheck, Bookmark, Globe, Camera, CodeXml, Music, Folder, Coffee, House, Plane, type LucideIcon } from 'lucide-react';

export const defaultMemoIcons = Object.freeze(['mic', 'users', 'doc', 'calendar', 'chat', 'chart', 'bulb', 'flag', 'star'] as const);
export const memoIcons: Record<string, { ko: string; en: string; Icon: LucideIcon }> = {
  mic: { ko: '녹음', en: 'Recording', Icon: Mic },
  users: { ko: '사람들', en: 'People', Icon: Users },
  doc: { ko: '문서', en: 'Document', Icon: FileText },
  calendar: { ko: '일정', en: 'Schedule', Icon: Calendar },
  chat: { ko: '대화', en: 'Conversation', Icon: MessageSquare },
  chart: { ko: '지표', en: 'Metrics', Icon: ChartColumn },
  bulb: { ko: '아이디어', en: 'Idea', Icon: Lightbulb },
  flag: { ko: '목표', en: 'Goal', Icon: Flag },
  star: { ko: '중요', en: 'Important', Icon: Star },
  headphones: { ko: '듣기', en: 'Listening', Icon: Headphones },
  book: { ko: '독서', en: 'Reading', Icon: BookOpen },
  briefcase: { ko: '업무', en: 'Work', Icon: Briefcase },
  graduation: { ko: '학습', en: 'Learning', Icon: GraduationCap },
  heart: { ko: '마음', en: 'Heart', Icon: Heart },
  check: { ko: '완료', en: 'Done', Icon: CircleCheck },
  bookmark: { ko: '북마크', en: 'Bookmark', Icon: Bookmark },
  globe: { ko: '세계', en: 'World', Icon: Globe },
  camera: { ko: '사진', en: 'Photo', Icon: Camera },
  code: { ko: '개발', en: 'Development', Icon: CodeXml },
  music: { ko: '음악', en: 'Music', Icon: Music },
  folder: { ko: '자료', en: 'Files', Icon: Folder },
  coffee: { ko: '휴식', en: 'Break', Icon: Coffee },
  home: { ko: '일상', en: 'Daily life', Icon: House },
  plane: { ko: '여행', en: 'Travel', Icon: Plane },
};
