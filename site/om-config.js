/* 오믹스메이트 앱 설정.
   Supabase 대시보드 > Project Settings > API 에서 Project URL 과 publishable key(또는 예전 anon public key)를 넣습니다.
   이 키는 공개되어도 되는 키입니다 (권한은 supabase/schema.sql 의 규칙이 지킵니다).
   secret / service_role key 는 절대 여기에 넣지 마세요.
   두 값이 비어 있으면 사이트는 지금처럼 카카오톡 상담으로 안내합니다. */
window.OM_CONFIG = {
  url: "https://ilohifauyxeqnjbftdhr.supabase.co",
  anonKey: "sb_publishable_DeKK9Vk4aQlcVjaNl6bENg_B99o-YDs"
};
