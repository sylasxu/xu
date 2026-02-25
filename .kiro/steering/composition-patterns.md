---
inclusion: fileMatch
fileMatchPattern: "apps/admin/src/**/*.{tsx,ts}"
---

# React Composition Patterns (Vercel)

> Source: vercel-labs/agent-skills/composition-patterns
> 适用于 Admin 后台 (React 19) 的组件架构设计

## When to Apply

- 重构有大量 boolean props 的组件
- 构建可复用组件库
- 设计灵活的组件 API
- 审查组件架构

## 1. Component Architecture (HIGH)

### 1.1 Avoid Boolean Props — Use Composition

❌ 错误：一个组件用 boolean props 控制行为

```tsx
<Composer isThread isEditing={false} channelId='abc' showAttachments showFormatting={false} />
```

✅ 正确：创建显式变体组件，各自组合所需部件

```tsx
// 每个变体明确自己渲染什么
function ThreadComposer({ channelId }: { channelId: string }) {
  return (
    <Composer.Frame>
      <Composer.Header />
      <Composer.Input />
      <AlsoSendToChannelField id={channelId} />
      <Composer.Footer>
        <Composer.Formatting />
        <Composer.Submit />
      </Composer.Footer>
    </Composer.Frame>
  )
}

function EditComposer() {
  return (
    <Composer.Frame>
      <Composer.Input />
      <Composer.Footer>
        <Composer.CancelEdit />
        <Composer.SaveEdit />
      </Composer.Footer>
    </Composer.Frame>
  )
}
```

### 1.2 Use Compound Components

用共享 context 构建复合组件，消费者自由组合所需部件。

```tsx
const ComposerContext = createContext<ComposerContextValue | null>(null)

function ComposerProvider({ children, state, actions, meta }: ProviderProps) {
  return (
    <ComposerContext value={{ state, actions, meta }}>
      {children}
    </ComposerContext>
  )
}

function ComposerInput() {
  const { state, actions: { update }, meta: { inputRef } } = use(ComposerContext)
  return (
    <TextInput ref={inputRef} value={state.input}
      onChangeText={(text) => update((s) => ({ ...s, input: text }))} />
  )
}

// 导出为复合组件
const Composer = {
  Provider: ComposerProvider,
  Frame: ComposerFrame,
  Input: ComposerInput,
  Submit: ComposerSubmit,
}
```

## 2. State Management (MEDIUM)

### 2.1 Decouple State from UI

Provider 是唯一知道状态如何管理的地方。UI 组件只消费 context 接口。

```tsx
// ✅ 状态管理隔离在 Provider 中
function ChannelProvider({ channelId, children }: Props) {
  const { state, update, submit } = useGlobalChannel(channelId)
  const inputRef = useRef(null)
  return (
    <Composer.Provider state={state} actions={{ update, submit }} meta={{ inputRef }}>
      {children}
    </Composer.Provider>
  )
}

// UI 组件只知道 context 接口
function ChannelComposer() {
  return (
    <Composer.Frame>
      <Composer.Input />
      <Composer.Submit />
    </Composer.Frame>
  )
}
```

### 2.2 Generic Context Interface for DI

定义 `state` / `actions` / `meta` 三部分的泛型接口，任何 Provider 都可以实现：

```tsx
interface ComposerContextValue {
  state: ComposerState      // input, attachments, isSubmitting
  actions: ComposerActions   // update, submit
  meta: ComposerMeta         // inputRef
}
```

同一 UI 组件可以搭配不同 Provider（本地状态 / 全局同步状态）。

### 2.3 Lift State into Providers

将状态提升到 Provider 组件，让兄弟组件也能访问。

```tsx
// ✅ Provider 外的组件也能访问状态
function ForwardMessageDialog() {
  return (
    <ForwardMessageProvider>
      <Dialog>
        <ForwardMessageComposer />
        <MessagePreview />  {/* 可以读 composer state */}
        <DialogActions>
          <ForwardButton /> {/* 可以调 submit */}
        </DialogActions>
      </Dialog>
    </ForwardMessageProvider>
  )
}
```

## 3. Implementation Patterns (MEDIUM)

### 3.1 Explicit Variants over Boolean Modes

```tsx
// ❌ 不清楚渲染什么
<Composer isThread isEditing={false} channelId='abc' />

// ✅ 一目了然
<ThreadComposer channelId="abc" />
<EditMessageComposer messageId="xyz" />
```

### 3.2 Children over Render Props

用 `children` 组合，而非 `renderX` props。Render props 仅在需要向子组件传递数据时使用。

```tsx
// ✅ children 组合
<Composer.Frame>
  <Composer.Input />
  <Composer.Footer>
    <Composer.Submit />
  </Composer.Footer>
</Composer.Frame>
```

## 4. React 19 APIs (MEDIUM)

> ⚠️ 仅 React 19+

- `ref` 是普通 prop，不需要 `forwardRef`
- 用 `use(MyContext)` 替代 `useContext(MyContext)`
- `use()` 可以在条件语句中调用

```tsx
// ❌ React 18
const ComposerInput = forwardRef<TextInput, Props>((props, ref) => { ... })
const value = useContext(MyContext)

// ✅ React 19
function ComposerInput({ ref, ...props }: Props & { ref?: React.Ref<TextInput> }) { ... }
const value = use(MyContext)
```
