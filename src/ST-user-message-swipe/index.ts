const MANAGER_BUTTON_NAME = '⚙';
const PANEL_ID = 'stums-manager-panel';
const PANEL_BACKDROP_ID = 'stums-manager-backdrop';
const MANAGED_CONTROL_ATTR = 'data-stums-managed';
const CREATED_CONTROL_ATTR = 'data-stums-created';
const STYLE_ID = 'stums-styles';
const HIDDEN_MESSAGE_BUTTON_CLASS = 'stums-hidden-message-button';
const SAVE_EDIT_AS_LATEST_SWIPE_BUTTON_CLASS = 'stums-save-edit-as-latest-swipe';
const RERENDER_DELAY_MS = 50;
const EDIT_LIFECYCLE_RENDER_DELAYS = [0, RERENDER_DELAY_MS, RERENDER_DELAY_MS * 4] as const;
const USER_MESSAGE_SELECTOR = '#chat > .mes[is_user="true"]';
const USER_SWIPE_CONTROL_SELECTOR = `${USER_MESSAGE_SELECTOR} .swipe_left, ${USER_MESSAGE_SELECTOR} .swipe_right, ${USER_MESSAGE_SELECTOR} .swipes-counter`;
const USER_SWIPE_REPAIR_SELECTOR = '.swipe_left, .swipe_right, .swipes-counter, .swipeRightBlock';
const MESSAGE_BUTTON_SELECTOR =
  '#chat > .mes .mes_button, #chat > .mes .mes_buttons .interactable, #chat > .mes .extraMesButtons .interactable';
const EDIT_LIFECYCLE_BUTTON_SELECTOR = [
  '.mes_edit',
  '.mes_edit_done',
  '.mes_edit_cancel',
  '.mes_edit_copy',
  '.mes_edit_add_reasoning',
  '.mes_edit_delete',
  '.mes_edit_up',
  '.mes_edit_down',
].join(', ');

const DEFAULT_SETTINGS = {
  force_latest_user_swipe_controls: true,
  show_save_edit_as_latest_swipe_button: true,
  message_button_rules: {} as Record<string, MessageButtonRule>,
  message_button_order: [] as string[],
};
const NATIVE_MESSAGE_BUTTON_CLASS_LABELS: Record<string, string> = {
  mes_edit: '编辑',
  mes_edit_done: '完成编辑',
  mes_edit_cancel: '取消编辑',
  mes_edit_copy: '复制编辑内容',
  mes_edit_add_reasoning: '添加思维链',
  mes_edit_delete: '删除',
  mes_edit_up: '上移',
  mes_edit_down: '下移',
  mes_delete: '删除消息',
  mes_regenerate: '重新生成',
  mes_continue: '继续',
  mes_impersonate: '扮演',
  mes_copy: '复制',
  mes_bookmark: '书签',
  mes_create_bookmark: '创建书签',
  mes_branch: '创建分支',
  mes_prompt: '查看提示词',
  mes_hide: '隐藏消息',
  mes_unhide: '取消隐藏消息',
};
const OFFICIAL_EXTENSION_BUTTON_CLASS_LABELS: Record<string, string> = {
  mes_translate: '翻译',
  mes_narrate: '朗读',
  mes_stop_narrate: '停止朗读',
  mes_caption: '图像描述',
  mes_embed: '向量化',
  sd_message_gen: '生成图片',
  sd_message_regenerate: '重新生成图片',
};
const MESSAGE_BUTTON_CLASS_LABELS: Record<string, string> = {
  ...NATIVE_MESSAGE_BUTTON_CLASS_LABELS,
  ...OFFICIAL_EXTENSION_BUTTON_CLASS_LABELS,
};
const MESSAGE_BUTTON_LABEL_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(MESSAGE_BUTTON_CLASS_LABELS).map(([key, label]) => [label, key]),
);
const OFFICIAL_EXTENSION_INJECTORS = new Set([
  'caption',
  'sd',
  'stable-diffusion',
  'tts',
  'translate',
  'vectors',
  'expressions',
]);
const IGNORED_MESSAGE_BUTTON_CLASSES = new Set([
  'interactable',
  'menu_button',
  'mes_button',
  'fa',
  'fa-solid',
  'fa-regular',
  'fa-brands',
  'fas',
  'far',
  'fab',
]);

let render_timeout: ReturnType<typeof window.setTimeout> | null = null;
let chat_mutation_observer: MutationObserver | null = null;
let observed_chat_element: Element | null = null;
let edit_lifecycle_event_controller: AbortController | null = null;
let manager_panel_drag_controller: AbortController | null = null;
let suppress_next_observer_render = false;

type SwipeMessage = ChatMessageSwiped & {
  message: string;
  role: string;
};
type UserSwipeMessage = SwipeMessage & {
  role: 'user';
};
type SwipeButtonHandlers = {
  click: EventListener;
  keydown: EventListener;
};
type MessageButtonRole = 'ai' | 'user';
type MessageButtonOrigin = 'native' | 'official' | 'third_party';
type MessageButtonRule = {
  show_ai: boolean;
  show_user: boolean;
};
type ManagerSettings = typeof DEFAULT_SETTINGS;
type MessageButtonDescriptor = {
  key: string;
  label: string;
  identifier: string;
  injector: string;
  origin: MessageButtonOrigin;
  first_seen_index: number;
  visible_roles: Record<MessageButtonRole, boolean>;
};

const button_handlers = new WeakMap<Element, SwipeButtonHandlers>();
let settings: ManagerSettings = { ...DEFAULT_SETTINGS };

function injectStyles(): void {
  if ($(`#${STYLE_ID}`).length > 0) {
    return;
  }

  $('<style>')
    .attr('id', STYLE_ID)
    .text(
      `
#chat > .mes[is_user="true"].stums-native-enabled .mes_text:empty::after {
	content: '\\00a0';
}

.${HIDDEN_MESSAGE_BUTTON_CLASS} {
	display: none !important;
}

#${PANEL_BACKDROP_ID} {
	display: none;
	position: fixed;
	inset: 0;
	z-index: 40000;
	background: transparent;
	pointer-events: none;
}

#${PANEL_ID} {
	position: fixed;
	top: 50%;
	left: 50%;
	z-index: 40001;
	width: min(560px, calc(100vw - 32px));
	max-height: min(720px, calc(100vh - 48px));
	transform: translate(-50%, -50%);
	overflow: hidden;
	border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.18));
	border-radius: 8px;
	background: var(--SmartThemeBlurTintColor, var(--SmartThemeBodyColor, #1f1f1f));
	color: var(--SmartThemeBodyColor, inherit);
	box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
}

#${PANEL_ID} .stums-panel-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 14px;
	border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.14));
	cursor: move;
	user-select: none;
}

#${PANEL_ID} .stums-panel-title {
	font-weight: 700;
}

#${PANEL_ID} .stums-panel-close {
	min-width: 32px;
	height: 32px;
	padding: 0;
	border-radius: 6px;
}

#${PANEL_ID} .stums-panel-body {
	display: grid;
	gap: 14px;
	max-height: calc(min(720px, calc(100vh - 48px)) - 57px);
	overflow: auto;
	padding: 14px;
}

#${PANEL_ID} .stums-panel-section {
	display: grid;
	gap: 8px;
}

#${PANEL_ID} .stums-panel-section-title {
	font-weight: 700;
}

#${PANEL_ID} .stums-toggle-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 8px 10px;
	border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.12));
	border-radius: 6px;
}

#${PANEL_ID} .stums-toggle-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

#${PANEL_ID} .stums-button-list {
  display: grid;
  gap: 6px;
}

#${PANEL_ID} .stums-button-header,
#${PANEL_ID} .stums-button-row {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 72px 72px;
  align-items: center;
  gap: 8px;
}

#${PANEL_ID} .stums-button-header {
  padding: 0 10px;
  font-size: 0.9em;
  font-weight: 700;
  opacity: 0.84;
}

#${PANEL_ID} .stums-button-row {
  padding: 8px 10px;
  border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.12));
  border-radius: 6px;
}

#${PANEL_ID} .stums-drag-handle {
  width: 14px;
  height: 24px;
  cursor: grab;
  background-image: radial-gradient(currentColor 1px, transparent 1px);
  background-size: 5px 5px;
  opacity: 0.58;
}

#${PANEL_ID} .stums-drag-handle:active {
  cursor: grabbing;
}

#${PANEL_ID} .stums-button-row.stums-dragging {
  opacity: 0.58;
}

#${PANEL_ID} .stums-sort-placeholder {
  min-height: 42px;
  border: 1px dashed var(--SmartThemeQuoteColor, currentColor);
  border-radius: 6px;
  opacity: 0.6;
}

#${PANEL_ID} .stums-button-name {
  min-width: 0;
  overflow-wrap: anywhere;
}

#${PANEL_ID} .stums-button-origin {
  display: inline-block;
  margin-left: 6px;
  opacity: 0.72;
  font-size: 0.9em;
}

#${PANEL_ID} .stums-button-identifier {
  margin-top: 2px;
  opacity: 0.68;
  font-size: 0.82em;
  overflow-wrap: anywhere;
}

#${PANEL_ID} .stums-button-checkbox {
  display: flex;
  justify-content: center;
}

#${PANEL_ID} .stums-empty {
  opacity: 0.75;
  padding: 8px 10px;
}

@media (max-width: 700px) {
  #${PANEL_ID} {
    inset: 0 !important;
    width: 100dvw;
    height: 100dvh;
    max-height: none;
    transform: none !important;
    border: 0;
    border-radius: 0;
  }

  #${PANEL_ID} .stums-panel-header {
    cursor: default;
  }

  #${PANEL_ID} .stums-panel-body {
    max-height: calc(100dvh - 57px);
  }
}
`,
    )
    .appendTo('head');
}

function getRuntimeFunction<T extends (...args: any[]) => any>(name: string): T | undefined {
  const runtime = globalThis as any;
  const helper = runtime.TavernHelper as Record<string, unknown> | undefined;
  const value = runtime[name] ?? helper?.[name];
  return typeof value === 'function' ? (value as T) : undefined;
}

function getRuntimeValue<T>(name: string): T | undefined {
  const runtime = globalThis as any;
  const helper = runtime.TavernHelper as Record<string, unknown> | undefined;
  return (runtime[name] ?? helper?.[name]) as T | undefined;
}

export function getFirstNonEmptyString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

export function canonicalizeMessageButtonKey(value: string): string {
  const normalized = value.trim();
  return MESSAGE_BUTTON_LABEL_KEYS[normalized] ?? normalized;
}

export function resolveMessageButtonLabel(identifier: string, exposed_name: string | undefined): string {
  return getFirstNonEmptyString(exposed_name) ?? identifier;
}

export function classifyMessageButtonOrigin(key: string): MessageButtonOrigin {
  if (key in NATIVE_MESSAGE_BUTTON_CLASS_LABELS || key.startsWith('mes_edit')) {
    return 'native';
  }
  if (key in OFFICIAL_EXTENSION_BUTTON_CLASS_LABELS) {
    return 'official';
  }
  return 'third_party';
}

export function classifyMessageButtonOriginByInjector(injector: string | undefined): MessageButtonOrigin | undefined {
  if (!injector) {
    return undefined;
  }
  const normalized = injector.trim().toLowerCase();
  if (normalized.length === 0) {
    return undefined;
  }
  if (normalized === 'mes_buttons' || normalized === 'native') {
    return 'native';
  }
  if (OFFICIAL_EXTENSION_INJECTORS.has(normalized)) {
    return 'official';
  }
  return 'third_party';
}

function parseMessageButtonRule(value: unknown): MessageButtonRule {
  const source = typeof value === 'object' && value !== null ? (value as Partial<MessageButtonRule>) : {};
  return {
    show_ai: typeof source.show_ai === 'boolean' ? source.show_ai : true,
    show_user: typeof source.show_user === 'boolean' ? source.show_user : true,
  };
}

function parseMessageButtonRules(value: unknown, hidden_button_keys: string[]): Record<string, MessageButtonRule> {
  const source = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const rules = Object.fromEntries(Object.entries(source).map(([key, rule]) => [key, parseMessageButtonRule(rule)]));
  hidden_button_keys.forEach(key => {
    rules[key] = { show_ai: false, show_user: false };
  });
  return rules;
}

function parseSettings(value: unknown): ManagerSettings {
  const source =
    typeof value === 'object' && value !== null
      ? (value as Partial<ManagerSettings> & { hidden_message_button_keys?: unknown })
      : {};
  const hidden_message_button_keys = Array.isArray(source.hidden_message_button_keys)
    ? source.hidden_message_button_keys.filter((key): key is string => typeof key === 'string')
    : [];
  return {
    force_latest_user_swipe_controls:
      typeof source.force_latest_user_swipe_controls === 'boolean'
        ? source.force_latest_user_swipe_controls
        : DEFAULT_SETTINGS.force_latest_user_swipe_controls,
    show_save_edit_as_latest_swipe_button:
      typeof source.show_save_edit_as_latest_swipe_button === 'boolean'
        ? source.show_save_edit_as_latest_swipe_button
        : DEFAULT_SETTINGS.show_save_edit_as_latest_swipe_button,
    message_button_rules: parseMessageButtonRules(source.message_button_rules, hidden_message_button_keys),
    message_button_order: Array.isArray(source.message_button_order)
      ? source.message_button_order.filter((key): key is string => typeof key === 'string')
      : DEFAULT_SETTINGS.message_button_order.slice(),
  };
}

function getScriptVariableOption(): { type: 'script'; script_id: string } | undefined {
  const get_script_id = getRuntimeFunction<typeof getScriptId>('getScriptId');
  const script_id = get_script_id?.();
  return script_id ? { type: 'script', script_id } : undefined;
}

function loadSettings(): ManagerSettings {
  const get_variables = getRuntimeFunction<typeof getVariables>('getVariables');
  const variable_option = getScriptVariableOption();
  if (get_variables && variable_option) {
    const variables = get_variables(variable_option) as { stums_settings?: unknown } | undefined;
    return parseSettings(variables?.stums_settings);
  }

  try {
    return parseSettings(JSON.parse(window.localStorage.getItem('stums_settings') || 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(): void {
  const replace_variables = getRuntimeFunction<typeof replaceVariables>('replaceVariables');
  const variable_option = getScriptVariableOption();
  if (replace_variables && variable_option) {
    replace_variables({ stums_settings: settings }, variable_option);
    return;
  }

  window.localStorage.setItem('stums_settings', JSON.stringify(settings));
}

function updateSettings(patch: Partial<ManagerSettings>): void {
  settings = parseSettings({ ...settings, ...patch });
  saveSettings();
  renderNativeUserSwipeControls();
  renderManagerPanelContent();
}

function reportError(error: unknown): void {
  if (typeof toastr !== 'undefined') {
    toastr.error(String(error), '用户消息分支');
  }
  console.error('[ST-user-message-swipe]', error);
}

function runSafely(task: () => void): void {
  try {
    task();
  } catch (error) {
    reportError(error);
  }
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Node).nodeType === 1 &&
    typeof (value as Element).matches === 'function' &&
    typeof (value as Element).querySelector === 'function'
  );
}

function getMessageElement(message_id: number): JQuery<HTMLElement> {
  return $(`#chat > .mes[mesid="${message_id}"]`);
}

function getAllMessages(): SwipeMessage[] {
  const get_last_message_id = getRuntimeFunction<typeof getLastMessageId>('getLastMessageId');
  const get_chat_messages = getRuntimeFunction<typeof getChatMessages>('getChatMessages');
  if (!get_last_message_id || !get_chat_messages) {
    return [];
  }

  const last_message_id = get_last_message_id();
  if (last_message_id < 0) {
    return [];
  }

  return get_chat_messages(`0-${last_message_id}`, { include_swipes: true }) as SwipeMessage[];
}

function isUserSwipeMessage(message: SwipeMessage): message is UserSwipeMessage {
  return message.role === 'user';
}

function readSwipeId(message: ChatMessageSwiped): number {
  const swipe_id = Number(message.swipe_id || 0);
  if (!Number.isInteger(swipe_id)) {
    return 0;
  }
  return Math.max(0, Math.min(swipe_id, Math.max(message.swipes.length - 1, 0)));
}

export function normalizeSwipes(message: SwipeMessage): string[] {
  const swipes = Array.isArray(message.swipes) ? message.swipes.slice() : [];
  if (swipes.length === 0) {
    swipes.push(message.message || '');
  }

  const swipe_id = readSwipeId({ ...message, swipes });
  if (swipes[swipe_id] === undefined || swipes[swipe_id] === null) {
    swipes[swipe_id] = message.message || '';
  }
  return swipes;
}

function normalizeSwipeObjects(source: Record<string, any>[] | undefined, length: number): Record<string, any>[] {
  const values = Array.isArray(source) ? source.slice() : [];
  while (values.length < length) {
    values.push({});
  }
  return values.slice(0, length);
}

export function shouldShowNativeUserSwipeControls(
  message: UserSwipeMessage,
  messages: SwipeMessage[],
  enabled = settings.force_latest_user_swipe_controls,
): boolean {
  if (!enabled) {
    return false;
  }
  const last_message = messages[messages.length - 1];
  return last_message?.role === 'user' && last_message.message_id === message.message_id;
}

async function updateMessageSwipe(
  message: SwipeMessage,
  swipes: string[],
  swipe_id: number,
  swipes_info = normalizeSwipeObjects(message.swipes_info, swipes.length),
  swipes_data = normalizeSwipeObjects(message.swipes_data, swipes.length),
): Promise<void> {
  const set_chat_messages = getRuntimeFunction<typeof setChatMessages>('setChatMessages');
  if (!set_chat_messages) {
    throw Error('当前环境缺少修改聊天消息的接口。');
  }

  await set_chat_messages([{ message_id: message.message_id, swipes, swipe_id, swipes_info, swipes_data }], {
    refresh: 'affected',
  });
  window.setTimeout(renderNativeUserSwipeControls, 0);
}

function consumeNativeEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function unbindManagedButton(element: Element): void {
  const handlers = button_handlers.get(element);
  if (!handlers) {
    return;
  }

  element.removeEventListener('click', handlers.click, true);
  element.removeEventListener('keydown', handlers.keydown, true);
  button_handlers.delete(element);
}

function bindNativeButton($button: JQuery<HTMLElement>, handler: () => Promise<void>): void {
  const element = $button[0];
  if (!element) {
    return;
  }

  unbindManagedButton(element);
  let running = false;
  const run = async (event: Event) => {
    consumeNativeEvent(event);
    if (running || $button.attr('aria-disabled') === 'true') {
      return;
    }

    running = true;
    try {
      await handler();
    } catch (error) {
      reportError(error);
    } finally {
      running = false;
    }
  };
  const click = (event: Event) => void run(event);
  const keydown = (event: Event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'Enter' && key !== ' ') {
      return;
    }
    void run(event);
  };

  element.addEventListener('click', click, true);
  element.addEventListener('keydown', keydown, true);
  button_handlers.set(element, { click, keydown });
}

function setNativeControlVisibility($control: JQuery<HTMLElement>, visible: boolean, display: string): void {
  $control.attr(MANAGED_CONTROL_ATTR, 'true').css(
    visible
      ? {
          display,
          visibility: '',
          opacity: '',
          'pointer-events': '',
        }
      : {
          display,
          visibility: 'hidden',
          opacity: '0',
          'pointer-events': 'none',
        },
  );
}

function resetManagedControls(): void {
  $(`.${SAVE_EDIT_AS_LATEST_SWIPE_BUTTON_CLASS}`).each((_, element) => {
    unbindManagedButton(element);
    $(element).remove();
  });

  $('#chat > .mes[is_user="true"]').each((_, element) => {
    const $message = $(element);
    $message.removeClass('swipes_visible stums-native-enabled');
    $message.find(`[${MANAGED_CONTROL_ATTR}="true"]`).each((_, control) => {
      unbindManagedButton(control);
      $(control).removeAttr(MANAGED_CONTROL_ATTR).removeAttr('style').removeAttr('aria-disabled');
    });
    $message.find(`[${CREATED_CONTROL_ATTR}="true"]`).remove();
  });

  $(MESSAGE_BUTTON_SELECTOR).removeClass(HIDDEN_MESSAGE_BUTTON_CLASS);
}

function createSwipeButton(class_names: string, label: string): JQuery<HTMLElement> {
  return $('<div>')
    .addClass(`${class_names} interactable`)
    .attr({
      [CREATED_CONTROL_ATTR]: 'true',
      'aria-label': label,
      role: 'button',
      tabindex: 0,
      title: label,
    }) as JQuery<HTMLElement>;
}

function ensureNativeSwipeControls($message: JQuery<HTMLElement>): void {
  if ($message.children('.swipe_left').length === 0) {
    const $left = createSwipeButton('swipe_left fa-solid fa-chevron-left', '上一条分支');
    const $mes_block = $message.children('.mes_block').first();
    if ($mes_block.length > 0) {
      $left.insertBefore($mes_block);
    } else {
      $message.append($left);
    }
  }

  let $right_block = $message.children('.swipeRightBlock').first() as JQuery<HTMLElement>;
  if ($right_block.length === 0) {
    $right_block = $('<div>')
      .addClass('flex-container swipeRightBlock flexFlowColumn flexNoGap')
      .attr(CREATED_CONTROL_ATTR, 'true') as JQuery<HTMLElement>;
    $message.append($right_block);
  }

  if ($right_block.children('.swipe_right').length === 0) {
    $right_block.prepend(createSwipeButton('swipe_right fa-solid fa-chevron-right', '下一条分支'));
  }
  if ($right_block.children('.swipes-counter').length === 0) {
    $right_block.append(
      $('<div>').addClass('swipes-counter').attr(CREATED_CONTROL_ATTR, 'true') as JQuery<HTMLElement>,
    );
  }
}

function isMessageEditing($message: JQuery<HTMLElement>): boolean {
  return $message.find('.edit_textarea, textarea').length > 0;
}

function insertMessageActionButton(
  $message: JQuery<HTMLElement>,
  $button: JQuery<HTMLElement>,
  anchor_selector?: string,
): JQuery<HTMLElement> {
  const $anchor = anchor_selector ? ($message.find(anchor_selector).last() as JQuery<HTMLElement>) : $();
  if ($anchor.length > 0) {
    $button.insertAfter($anchor);
    return $button;
  }

  const $button_bar = $message.find('.mes_buttons, .extraMesButtons').first();
  if ($button_bar.length > 0) {
    $button_bar.append($button);
    return $button;
  }

  $message.append($button);
  return $button;
}

function ensureMessageActionButton(
  $message: JQuery<HTMLElement>,
  button_class: string,
  icon_class: string,
  label: string,
  anchor_selector?: string,
): JQuery<HTMLElement> {
  const $existing_button = $message.find(`.${button_class}`).first() as JQuery<HTMLElement>;
  if ($existing_button.length > 0) {
    return $existing_button;
  }

  const $button = $('<div>')
    .addClass(`mes_button menu_button ${button_class} fa-solid ${icon_class} interactable`)
    .attr({
      title: label,
      'aria-label': label,
      role: 'button',
      tabindex: 0,
    }) as JQuery<HTMLElement>;
  return insertMessageActionButton($message, $button, anchor_selector);
}

function ensureSaveEditAsLatestSwipeButton($message: JQuery<HTMLElement>): JQuery<HTMLElement> {
  return ensureMessageActionButton(
    $message,
    SAVE_EDIT_AS_LATEST_SWIPE_BUTTON_CLASS,
    'fa-code-branch',
    '保存为最新分支',
    '.mes_edit_done',
  );
}

function getEditedMessageText($message: JQuery<HTMLElement>): string {
  const value = ($message.find('.edit_textarea, textarea').first() as JQuery<HTMLTextAreaElement>).val();
  return typeof value === 'string' ? value : '';
}

function enableSaveEditAsLatestSwipeButton(message: SwipeMessage): void {
  if (!settings.show_save_edit_as_latest_swipe_button) {
    return;
  }

  const $message = getMessageElement(message.message_id);
  if ($message.length === 0 || !isMessageEditing($message)) {
    return;
  }

  const swipes = normalizeSwipes(message);
  const swipes_info = normalizeSwipeObjects(message.swipes_info, swipes.length);
  const swipes_data = normalizeSwipeObjects(message.swipes_data, swipes.length);
  const $button = ensureSaveEditAsLatestSwipeButton($message);
  setNativeControlVisibility($button, true, 'flex');
  bindNativeButton($button, async () => {
    const edited_message = getEditedMessageText($message);
    await updateMessageSwipe(
      message,
      swipes.concat(edited_message),
      swipes.length,
      swipes_info.concat({}),
      swipes_data.concat({}),
    );
    if (typeof toastr !== 'undefined') {
      toastr.success('已保存为最新分支。', '消息按钮管理器');
    }
  });
}

function enableNativeUserSwipeControls(message: UserSwipeMessage): void {
  const $message = getMessageElement(message.message_id);
  if ($message.length === 0) {
    return;
  }

  const swipes = normalizeSwipes(message);
  const swipe_id = readSwipeId({ ...message, swipes });
  const swipes_info = normalizeSwipeObjects(message.swipes_info, swipes.length);
  const swipes_data = normalizeSwipeObjects(message.swipes_data, swipes.length);
  ensureNativeSwipeControls($message);
  const $left = $message.children('.swipe_left').first() as JQuery<HTMLElement>;
  const $right_block = $message.children('.swipeRightBlock').first();
  const $right = $right_block.children('.swipe_right').first() as JQuery<HTMLElement>;
  const $counter = $right_block.children('.swipes-counter').first() as JQuery<HTMLElement>;
  const is_editing = isMessageEditing($message);

  $message.addClass('stums-native-enabled');
  if (is_editing) {
    $message.removeClass('swipes_visible');
  } else {
    $message.addClass('swipes_visible');
  }
  setNativeControlVisibility($left, swipe_id > 0, 'block');
  setNativeControlVisibility($right, true, 'flex');
  setNativeControlVisibility($counter, true, 'flex');
  $counter.text(`${swipe_id + 1}\u200b/\u200b${swipes.length}`);
  if (swipes.length > 1) {
    $counter.addClass('swipe-picker-enabled interactable');
  } else {
    $counter.removeClass('swipe-picker-enabled interactable');
  }
  $left.attr('aria-disabled', swipe_id > 0 ? 'false' : 'true');
  $right.attr('aria-disabled', 'false');

  bindNativeButton($left, async () => {
    await updateMessageSwipe(message, swipes, Math.max(0, swipe_id - 1), swipes_info, swipes_data);
  });
  bindNativeButton($right, async () => {
    if (swipe_id < swipes.length - 1) {
      await updateMessageSwipe(message, swipes, swipe_id + 1, swipes_info, swipes_data);
      return;
    }

    await updateMessageSwipe(message, swipes.concat(''), swipes.length, swipes_info.concat({}), swipes_data.concat({}));
  });
}

function getMessageButtonClasses(element: Element): string[] {
  return Array.from(element.classList).filter(class_name => {
    if (IGNORED_MESSAGE_BUTTON_CLASSES.has(class_name)) {
      return false;
    }
    if (class_name.startsWith('fa-') || class_name.startsWith('stums-')) {
      return false;
    }
    return true;
  });
}

function getMessageButtonInjector(element: Element): string | undefined {
  const explicit_injector = getFirstNonEmptyString(
    element.getAttribute('data-extension'),
    element.getAttribute('data-extension-name'),
    element.getAttribute('data-source'),
    element.getAttribute('data-module'),
    element.getAttribute('data-button-source'),
    element.closest('[data-extension]')?.getAttribute('data-extension'),
    element.closest('[data-extension-name]')?.getAttribute('data-extension-name'),
  );
  if (explicit_injector) {
    return explicit_injector;
  }
  if (element.closest('.mes_buttons') && !element.closest('.extraMesButtons')) {
    return 'mes_buttons';
  }
  return getFirstNonEmptyString(
    element.closest('[id]')?.getAttribute('id'),
    element.closest('[class]')?.getAttribute('class'),
  );
}

function isMessageButtonRenderedVisible(element: Element): boolean {
  const $element = $(element);
  return (
    !$element.hasClass(HIDDEN_MESSAGE_BUTTON_CLASS) &&
    element.getAttribute('hidden') === null &&
    $element.css('display') !== 'none' &&
    $element.css('visibility') !== 'hidden'
  );
}

function getMessageButtonDescriptor(element: Element, first_seen_index: number): MessageButtonDescriptor | undefined {
  if (element.closest(`.${SAVE_EDIT_AS_LATEST_SWIPE_BUTTON_CLASS}`)) {
    return undefined;
  }

  const meaningful_classes = getMessageButtonClasses(element);
  const exposed_name = getFirstNonEmptyString(
    element.getAttribute('title'),
    element.getAttribute('aria-label'),
    element.textContent,
  );
  const raw_identifier =
    meaningful_classes.find(class_name => class_name.startsWith('mes_')) ?? meaningful_classes[0] ?? exposed_name;
  if (!raw_identifier) {
    return undefined;
  }

  const identifier = canonicalizeMessageButtonKey(raw_identifier);
  const injector = getMessageButtonInjector(element) ?? 'unknown';
  const key = `${injector}:${identifier}`;
  const label = resolveMessageButtonLabel(identifier, exposed_name);
  const origin = classifyMessageButtonOriginByInjector(injector) ?? classifyMessageButtonOrigin(identifier);
  const role = getMessageButtonRole(element);
  return {
    key,
    label,
    identifier,
    injector,
    origin,
    first_seen_index,
    visible_roles: {
      ai: role === 'ai' && isMessageButtonRenderedVisible(element),
      user: role === 'user' && isMessageButtonRenderedVisible(element),
    },
  };
}

export function sortMessageButtonDescriptors(
  descriptors: MessageButtonDescriptor[],
  message_button_order: string[],
): MessageButtonDescriptor[] {
  const order_index = new Map(message_button_order.map((key, index) => [key, index]));
  return descriptors.slice().sort((left, right) => {
    const left_order = order_index.get(left.key);
    const right_order = order_index.get(right.key);
    if (left_order !== undefined || right_order !== undefined) {
      return (left_order ?? Number.MAX_SAFE_INTEGER) - (right_order ?? Number.MAX_SAFE_INTEGER);
    }
    return left.first_seen_index - right.first_seen_index;
  });
}

function collectMessageButtonDescriptors(): MessageButtonDescriptor[] {
  const descriptors = new Map<string, MessageButtonDescriptor>();
  let first_seen_index = 0;
  $(MESSAGE_BUTTON_SELECTOR).each((_, element) => {
    const descriptor = getMessageButtonDescriptor(element, first_seen_index);
    first_seen_index += 1;
    if (!descriptor) {
      return;
    }
    const existing_descriptor = descriptors.get(descriptor.key);
    if (!existing_descriptor) {
      descriptors.set(descriptor.key, descriptor);
      return;
    }
    existing_descriptor.visible_roles.ai ||= descriptor.visible_roles.ai;
    existing_descriptor.visible_roles.user ||= descriptor.visible_roles.user;
  });
  return sortMessageButtonDescriptors(Array.from(descriptors.values()), settings.message_button_order);
}

function getMessageButtonRole(element: Element): MessageButtonRole {
  return element.closest('#chat > .mes')?.getAttribute('is_user') === 'true' ? 'user' : 'ai';
}

function getMessageButtonRule(key: string): MessageButtonRule {
  return settings.message_button_rules[key] ?? { show_ai: true, show_user: true };
}

function isMessageButtonVisible(key: string, role: MessageButtonRole): boolean {
  const rule = getMessageButtonRule(key);
  return role === 'user' ? rule.show_user : rule.show_ai;
}

function applyMessageButtonVisibility(): void {
  $(MESSAGE_BUTTON_SELECTOR).each((_, element) => {
    const descriptor = getMessageButtonDescriptor(element, 0);
    if (!descriptor) {
      return;
    }
    $(element).toggleClass(
      HIDDEN_MESSAGE_BUTTON_CLASS,
      !isMessageButtonVisible(descriptor.key, getMessageButtonRole(element)),
    );
  });
}

function setMessageButtonVisible(key: string, role: MessageButtonRole, visible: boolean): void {
  const rule = getMessageButtonRule(key);
  updateSettings({
    message_button_rules: {
      ...settings.message_button_rules,
      [key]: role === 'user' ? { ...rule, show_user: visible } : { ...rule, show_ai: visible },
    },
  });
}

function setMessageButtonOrder(message_button_order: string[]): void {
  updateSettings({ message_button_order });
}

function createToggleRow(label: string, checked: boolean, on_change: (checked: boolean) => void): JQuery<HTMLElement> {
  const $input = $('<input>').attr({ type: 'checkbox' }).prop('checked', checked);
  $input.on('change', () => on_change($input.prop('checked') === true));

  return $('<label>')
    .addClass('stums-toggle-row')
    .append($('<span>').addClass('stums-toggle-label').text(label))
    .append($input) as JQuery<HTMLElement>;
}

function createMessageButtonCheckbox(
  descriptor: MessageButtonDescriptor,
  role: MessageButtonRole,
): JQuery<HTMLElement> {
  const $input = $('<input>')
    .attr({
      type: 'checkbox',
      'aria-label': role === 'ai' ? 'AI消息显示' : '用户消息显示',
    })
    .prop('checked', descriptor.visible_roles[role] && isMessageButtonVisible(descriptor.key, role));
  $input.on('change', () => setMessageButtonVisible(descriptor.key, role, $input.prop('checked') === true));
  return $('<div>').addClass('stums-button-checkbox').append($input) as JQuery<HTMLElement>;
}

function createMessageButtonRow(descriptor: MessageButtonDescriptor): JQuery<HTMLElement> {
  const origin_label =
    descriptor.origin === 'native' ? '酒馆原生' : descriptor.origin === 'official' ? '官方扩展' : '第三方扩展';
  const $row = $('<div>')
    .addClass('stums-button-row')
    .attr('data-button-key', descriptor.key)
    .append($('<div>').addClass('stums-drag-handle').attr('title', '拖动排序'))
    .append(
      $('<div>')
        .addClass('stums-button-name')
        .append(
          $('<div>').text(descriptor.label).append($('<span>').addClass('stums-button-origin').text(origin_label)),
        )
        .append(
          $('<div>').addClass('stums-button-identifier').text(`${descriptor.injector} / ${descriptor.identifier}`),
        ),
    )
    .append(createMessageButtonCheckbox(descriptor, 'ai'))
    .append(createMessageButtonCheckbox(descriptor, 'user')) as JQuery<HTMLElement>;

  return $row;
}

function enableMessageButtonSorting($list: JQuery<HTMLElement>): void {
  const sortable = ($list as any).sortable as ((options: Record<string, unknown>) => JQuery<HTMLElement>) | undefined;
  if (typeof sortable !== 'function') {
    return;
  }
  sortable.call($list, {
    axis: 'y',
    containment: 'parent',
    forcePlaceholderSize: true,
    handle: '.stums-drag-handle',
    placeholder: 'stums-sort-placeholder',
    tolerance: 'pointer',
    update: () => setMessageButtonOrder(readRenderedMessageButtonOrder()),
  });
}

function readRenderedMessageButtonOrder(): string[] {
  return $(`#${PANEL_ID} .stums-button-row`)
    .toArray()
    .map(row => String($(row).attr('data-button-key') ?? ''))
    .filter(key => key.length > 0);
}

function renderButtonManagerGroup($body: JQuery<HTMLElement>): void {
  const descriptors = collectMessageButtonDescriptors();
  const $section = $('<section>').addClass('stums-panel-section');
  $section.append($('<div>').addClass('stums-panel-section-title').text('消息按钮'));

  if (descriptors.length === 0) {
    $section.append($('<div>').addClass('stums-empty').text('当前没有检测到消息按钮。'));
  } else {
    const $list = $('<div>').addClass('stums-button-list');
    $list.append(
      $('<div>')
        .addClass('stums-button-header')
        .append($('<div>'))
        .append($('<div>').text('按钮'))
        .append($('<div>').addClass('stums-button-checkbox').text('AI消息'))
        .append($('<div>').addClass('stums-button-checkbox').text('用户消息')),
    );
    descriptors.forEach(descriptor => {
      $list.append(createMessageButtonRow(descriptor));
    });
    enableMessageButtonSorting($list);
    $section.append($list);
  }

  $body.append($section);
}

function renderEnhancementGroup($body: JQuery<HTMLElement>): void {
  const $section = $('<section>').addClass('stums-panel-section');
  $section.append($('<div>').addClass('stums-panel-section-title').text('脚本增强'));
  $section.append(
    createToggleRow('最后用户消息强制显示分支箭头', settings.force_latest_user_swipe_controls, checked =>
      updateSettings({ force_latest_user_swipe_controls: checked }),
    ),
  );
  $section.append(
    createToggleRow('编辑后保存为最新分支按钮', settings.show_save_edit_as_latest_swipe_button, checked =>
      updateSettings({ show_save_edit_as_latest_swipe_button: checked }),
    ),
  );
  $body.append($section);
}

function renderManagerPanelContent(): void {
  const $panel = $(`#${PANEL_ID}`);
  if ($panel.length === 0) {
    return;
  }

  const $body = $panel.find('.stums-panel-body').empty() as JQuery<HTMLElement>;
  renderButtonManagerGroup($body);
  renderEnhancementGroup($body);
  applyMessageButtonVisibility();
}

export function clampPanelPosition(
  left: number,
  top: number,
  panel_width: number,
  panel_height: number,
  viewport_width: number,
  viewport_height: number,
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(left, Math.max(0, viewport_width - panel_width))),
    top: Math.max(0, Math.min(top, Math.max(0, viewport_height - panel_height))),
  };
}

export function isNarrowManagerPanelViewportByWidth(viewport_width: number): boolean {
  return viewport_width <= 700;
}

function getPanelViewport(panel?: HTMLElement): { width: number; height: number; window: Window } {
  const view = panel?.ownerDocument.defaultView ?? window;
  const viewport = view.visualViewport;
  return {
    width: viewport?.width ?? view.innerWidth,
    height: viewport?.height ?? view.innerHeight,
    window: view,
  };
}

function isNarrowManagerPanelViewport(panel?: HTMLElement): boolean {
  return isNarrowManagerPanelViewportByWidth(getPanelViewport(panel).width);
}

function resetManagerPanelPosition($panel: JQuery<HTMLElement>): void {
  const panel = $panel[0];
  if (isNarrowManagerPanelViewport(panel)) {
    $panel.css({
      left: '0',
      top: '0',
      transform: 'none',
    });
    return;
  }

  $panel.css({
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
  });
}

function bindManagerPanelDrag($panel: JQuery<HTMLElement>): void {
  manager_panel_drag_controller?.abort();
  manager_panel_drag_controller = new AbortController();
  const panel = $panel[0];
  const header = $panel.find('.stums-panel-header')[0];
  if (!panel || !header) {
    return;
  }

  header.addEventListener(
    'pointerdown',
    event => {
      const panel_viewport = getPanelViewport(panel);
      if (
        isNarrowManagerPanelViewport(panel) ||
        (isElement(event.target) && event.target.closest('.stums-panel-close'))
      ) {
        return;
      }

      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const start_position = clampPanelPosition(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        panel_viewport.width,
        panel_viewport.height,
      );
      panel.style.left = `${start_position.left}px`;
      panel.style.top = `${start_position.top}px`;
      panel.style.transform = 'none';
      const start_left = start_position.left;
      const start_top = start_position.top;
      const start_x = event.clientX;
      const start_y = event.clientY;
      const drag_controller = new AbortController();
      panel.classList.add('stums-panel-dragging');

      const move = (move_event: PointerEvent) => {
        const position = clampPanelPosition(
          start_left + move_event.clientX - start_x,
          start_top + move_event.clientY - start_y,
          panel.offsetWidth,
          panel.offsetHeight,
          panel_viewport.width,
          panel_viewport.height,
        );
        panel.style.left = `${position.left}px`;
        panel.style.top = `${position.top}px`;
      };
      const stop = () => {
        panel.classList.remove('stums-panel-dragging');
        drag_controller.abort();
      };

      panel_viewport.window.addEventListener('pointermove', move, { signal: drag_controller.signal });
      panel_viewport.window.addEventListener('pointerup', stop, { once: true, signal: drag_controller.signal });
      panel_viewport.window.addEventListener('pointercancel', stop, { once: true, signal: drag_controller.signal });
    },
    { signal: manager_panel_drag_controller.signal },
  );
}

function closeManagerPanel(): void {
  manager_panel_drag_controller?.abort();
  manager_panel_drag_controller = null;
  $(`#${PANEL_ID}, #${PANEL_BACKDROP_ID}`).remove();
}

function openManagerPanel(): void {
  closeManagerPanel();

  const $panel = $('<div>')
    .attr({
      id: PANEL_ID,
      role: 'dialog',
      'aria-label': '消息按钮管理器',
    })
    .append(
      $('<div>')
        .addClass('stums-panel-header')
        .append($('<div>').addClass('stums-panel-title').text('消息按钮管理器'))
        .append(
          $('<button>')
            .addClass('menu_button stums-panel-close')
            .attr('type', 'button')
            .text('x')
            .on('click', closeManagerPanel),
        ),
    )
    .append($('<div>').addClass('stums-panel-body')) as JQuery<HTMLElement>;
  $panel.appendTo('body');
  resetManagerPanelPosition($panel);
  bindManagerPanelDrag($panel);
  renderManagerPanelContent();
  getPanelViewport($panel[0]).window.requestAnimationFrame(() => resetManagerPanelPosition($panel));
}

function renderNativeUserSwipeControls(): void {
  suppress_next_observer_render = true;

  const messages = getAllMessages();
  if (messages.length === 0 && $('#chat > .mes').length > 0) {
    suppress_next_observer_render = false;
    return;
  }

  resetManagedControls();
  messages.forEach(message => {
    enableSaveEditAsLatestSwipeButton(message);
    if (isUserSwipeMessage(message) && shouldShowNativeUserSwipeControls(message, messages)) {
      enableNativeUserSwipeControls(message);
    }
  });
  applyMessageButtonVisibility();
  renderManagerPanelContent();

  window.setTimeout(() => {
    suppress_next_observer_render = false;
  }, 0);
}

function scheduleRender(): void {
  if (render_timeout) {
    window.clearTimeout(render_timeout);
  }
  render_timeout = window.setTimeout(() => {
    render_timeout = null;
    runSafely(renderNativeUserSwipeControls);
  }, RERENDER_DELAY_MS);
}

function scheduleEditLifecycleRender(): void {
  EDIT_LIFECYCLE_RENDER_DELAYS.forEach(delay => {
    window.setTimeout(() => runSafely(renderNativeUserSwipeControls), delay);
  });
}

export function shouldRenderForChatMutation(mutations: MutationRecord[]): boolean {
  return mutations.some(mutation => {
    if (mutation.type === 'attributes') {
      if (mutation.attributeName !== 'class' && mutation.attributeName !== 'style') {
        return false;
      }
      if (!isElement(mutation.target)) {
        return false;
      }
      return (
        (mutation.attributeName === 'class' && mutation.target.matches(USER_MESSAGE_SELECTOR)) ||
        mutation.target.matches(USER_SWIPE_CONTROL_SELECTOR)
      );
    }

    if (mutation.type !== 'childList') {
      return false;
    }
    const mutation_target = isElement(mutation.target) ? mutation.target : null;
    const is_inside_user_message = mutation_target?.closest(USER_MESSAGE_SELECTOR) !== null;
    return [...mutation.addedNodes, ...mutation.removedNodes].some(node => {
      if (!isElement(node)) {
        return false;
      }
      if (node.matches('.mes') || node.querySelector('.mes') !== null) {
        return true;
      }
      return (
        is_inside_user_message &&
        (node.matches(USER_SWIPE_REPAIR_SELECTOR) || node.querySelector(USER_SWIPE_REPAIR_SELECTOR) !== null)
      );
    });
  });
}

function bindEditLifecycleRenderEvents(): void {
  edit_lifecycle_event_controller?.abort();
  const chat = $('#chat')[0];
  if (!chat) {
    return;
  }

  edit_lifecycle_event_controller = new AbortController();
  const on_edit_lifecycle_event = (event: Event) => {
    if (event.type === 'keydown') {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Enter' && key !== ' ') {
        return;
      }
    }

    const target = event.target;
    if (!isElement(target)) {
      return;
    }
    const button = target.closest(EDIT_LIFECYCLE_BUTTON_SELECTOR);
    if (!button || !chat.contains(button) || button.closest('#chat > .mes') === null) {
      return;
    }

    scheduleEditLifecycleRender();
  };
  chat.addEventListener('click', on_edit_lifecycle_event, {
    capture: true,
    signal: edit_lifecycle_event_controller.signal,
  });
  chat.addEventListener('keydown', on_edit_lifecycle_event, {
    capture: true,
    signal: edit_lifecycle_event_controller.signal,
  });
}

function observeChatMutations(): void {
  const chat_element = $('#chat')[0];
  if (!chat_element || observed_chat_element === chat_element) {
    return;
  }

  chat_mutation_observer?.disconnect();
  observed_chat_element = chat_element;
  chat_mutation_observer = new MutationObserver(mutations => {
    if (suppress_next_observer_render) {
      return;
    }

    if (shouldRenderForChatMutation(mutations)) {
      scheduleRender();
    }
  });
  chat_mutation_observer.observe(chat_element, {
    attributeFilter: ['class', 'style'],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

function registerRenderEvents(): void {
  const event_on = getRuntimeFunction<typeof eventOn>('eventOn');
  const events = getRuntimeValue<typeof tavern_events>('tavern_events');
  if (!event_on || !events) {
    return;
  }

  event_on(events.CHAT_CHANGED, scheduleRender);
  event_on(events.USER_MESSAGE_RENDERED, scheduleRender);
  event_on(events.CHARACTER_MESSAGE_RENDERED, scheduleRender);
  event_on(events.MESSAGE_UPDATED, scheduleRender);
  event_on(events.MESSAGE_DELETED, scheduleRender);
  event_on(events.MESSAGE_SWIPED, scheduleRender);
  event_on(events.MESSAGE_SWIPE_DELETED, scheduleRender);
  event_on(events.MORE_MESSAGES_LOADED, scheduleRender);
}

function registerManagerButton(): void {
  const append_script_buttons = getRuntimeFunction<typeof appendInexistentScriptButtons>(
    'appendInexistentScriptButtons',
  );
  const event_on = getRuntimeFunction<typeof eventOn>('eventOn');
  const get_button_event = getRuntimeFunction<typeof getButtonEvent>('getButtonEvent');

  append_script_buttons?.([{ name: MANAGER_BUTTON_NAME, visible: true }]);
  if (!event_on || !get_button_event) {
    return;
  }

  event_on(get_button_event(MANAGER_BUTTON_NAME), openManagerPanel);
}

function init(): void {
  settings = loadSettings();
  injectStyles();
  registerManagerButton();
  observeChatMutations();
  bindEditLifecycleRenderEvents();
  runSafely(renderNativeUserSwipeControls);
  registerRenderEvents();

  $(window).on('pagehide', () => {
    if (render_timeout) {
      window.clearTimeout(render_timeout);
      render_timeout = null;
    }
    chat_mutation_observer?.disconnect();
    chat_mutation_observer = null;
    observed_chat_element = null;
    edit_lifecycle_event_controller?.abort();
    edit_lifecycle_event_controller = null;
    closeManagerPanel();
    resetManagedControls();
    $(`#${STYLE_ID}`).remove();
  });
}

$(() => {
  runSafely(init);
});
