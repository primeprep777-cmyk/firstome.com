/* 오믹스메이트 앱 설정.
   Supabase 대시보드 > Project Settings > API 에서 Project URL 과 anon(public) key 를 복사해 넣습니다.
   anon key 는 공개되어도 되는 키입니다 (권한은 supabase/schema.sql 의 규칙이 지킵니다).
   service_role key 는 절대 여기에 넣지 마세요.
   두 값이 비어 있으면 사이트는 지금처럼 카카오톡 상담으로 안내합니다. */
window.OM_CONFIG = {
  url: "",
  anonKey: ""
};
