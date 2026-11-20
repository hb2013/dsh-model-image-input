/**
 * Client half of dsh-model-image-input.
 *
 * Registers the Models page's `settings.models.provider-card` extension seat
 * for the `llm-pi-ai` adapter family (every third-party / OpenAI-compatible
 * provider card) and draws one "supports images" checkbox per model. The
 * checkbox reflects the model's EFFECTIVE input modalities — the entry's own
 * `input`, then the installed catalog's, then the route's `defaultInput`,
 * exactly the precedence `dsh-llm-pi-ai` resolves — and writes through the
 * official settings service (`settings/mutate` on the `llm-pi-ai` namespace)
 * with revision fencing, the same wire the official editor uses:
 *
 * - a route whose profile carries a `models` list gets the whole array
 *   rewritten with the entry's `input` set (mirroring the official editor);
 * - a catalog route without a `models` list gets a single
 *   `modelOverrides.<id>.input` leaf, the field pi-ai ships for reshaping
 *   one catalog model while the rest keeps serving untouched.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-image-input',
  factory(require) {
    const React = require('react');
    const { useEffect, useMemo, useReducer, useState } = React;
    const h = React.createElement;

    /** Locale namespace this plugin owns. */
    const NS = 'settings.models.image-input';

    /** Settings namespace of the pi-ai adapter family this panel serves. */
    const SETTINGS_NS = 'llm-pi-ai';

    /** Row count from which the list grows a filter input (the host's own model picker does the same). */
    const FILTER_THRESHOLD = 8;

    const en = {
      title: 'Image input',
      hint: 'Checked models accept image attachments (input types: text + image).',
      supportImage: 'Supports images',
      tagOverride: 'override',
      tagInherited: 'inherited',
      tagOverrideTitle: 'Input declared explicitly on this model',
      tagInheritedTitle: 'Input from the installed catalog or the route default',
      empty: 'No configurable models yet. Add them under Edit → Customized settings, then check them here.',
      loading: 'Loading models…',
      filter: 'Filter models',
      filterNone: 'No model matches this filter.',
      loadError: 'Failed to load: {message}',
      saveError: 'Failed to save: {message}',
      conflict: 'Settings changed elsewhere; reloading.',
      readOnly: 'Settings are read-only here; checkboxes are disabled.',
    };

    const zh = {
      title: '图片输入',
      hint: '勾选后该模型可接收并识别图片附件（输入类型：文本 + 图片）。',
      supportImage: '支持图片',
      tagOverride: '已设置',
      tagInherited: '继承',
      tagOverrideTitle: '已在模型配置中显式声明输入类型',
      tagInheritedTitle: '输入类型来自内置目录或路由默认值',
      empty: '还没有可配置的模型。点击「编辑」→「自定义设置」添加模型后再来勾选。',
      loading: '正在读取模型…',
      filter: '搜索模型',
      filterNone: '没有匹配的模型。',
      loadError: '读取失败：{message}',
      saveError: '保存失败：{message}',
      conflict: '设置已在别处修改，正在重新加载。',
      readOnly: '当前设置只读，勾选框已禁用。',
    };

    /** Whether a value is a plain (non-array) object. */
    function isRecord(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /** The object at a settings path, or undefined when the walk leaves object shape. */
    function objectAt(source, path) {
      let current = source;
      for (const key of path) {
        if (!isRecord(current)) return undefined;
        current = current[key];
      }
      return isRecord(current) ? current : undefined;
    }

    /** A nonempty modality list, or undefined when absent or empty (the adapter reads both the same). */
    function declaredInput(value) {
      return Array.isArray(value) && value.length > 0 ? value.filter(item => item === 'text' || item === 'image') : undefined;
    }

    /**
     * One provider's rows: every model the route currently serves, its
     * effective image support, and where a checkbox write must land.
     * @param nsView - the llm-pi-ai namespace view (layered, redacted).
     * @param entry - the provider directory row (route id, settings address).
     * @param catalog - installed-catalog entries for the route, when it has one.
     * @returns rows plus the write targets the toggle needs.
     */
    function computeRows(nsView, entry, catalog) {
      const value = objectAt(nsView?.value, entry.settingsPath);
      const user = objectAt(nsView?.user, entry.settingsPath);
      const valueModels = Array.isArray(value?.models) && value.models.length > 0 ? value.models : undefined;
      const userModels = Array.isArray(user?.models) && user.models.length > 0 ? user.models : undefined;
      const overrides = isRecord(value?.modelOverrides) ? value.modelOverrides : {};
      const fallbackInput = declaredInput(value?.defaultInput) ?? ['text'];
      const catalogInput = new Map();
      for (const model of catalog ?? []) {
        const modalities = declaredInput(model.inputModalities);
        if (model.id.length > 0 && modalities !== undefined) catalogInput.set(model.id, modalities);
      }
      // Effective model set: a stored `models` list replaces the catalog.
      const seen = new Set();
      const rows = [];
      const sources = valueModels ?? catalog ?? [];
      for (const model of sources) {
        const id = String(model?.id ?? '');
        if (id.length === 0 || seen.has(id)) continue;
        seen.add(id);
        const own = valueModels !== undefined
          ? declaredInput(model?.input)
          : declaredInput(overrides[id]?.input);
        const inherited = catalogInput.get(id);
        const effective = own ?? inherited ?? fallbackInput;
        rows.push({
          id,
          name: typeof model?.name === 'string' && model.name.length > 0 ? model.name : id,
          image: effective.includes('image'),
          source: own !== undefined ? 'override' : 'inherited',
          write: valueModels !== undefined ? { kind: 'models', id } : { kind: 'override', id },
        });
      }
      return { rows, userModels, valueModels };
    }

    /** Fill-in translation: replaces `{name}` placeholders in a bound string. */
    function fill(text, name, value) {
      return text.split(`{${name}}`).join(value);
    }

    /** The provider-card extension panel; owner props come from the Models page. */
    function ImageInputPanel(props) {
      const { provider, configured, t, services } = props;
      const [state, setState] = useState({ status: 'loading', rows: [] });
      const [saving, setSaving] = useState('');
      const [error, setError] = useState('');
      const [query, setQuery] = useState('');
      const [tick, bump] = useReducer(current => current + 1, 0);

      useEffect(() => {
        if (configured !== true || provider.settingsNs !== SETTINGS_NS) return;
        let live = true;
        setState(current => (current.status === 'ready' ? current : { status: 'loading', rows: [] }));
        services.read(provider).then(
          result => { if (live) setState(result); },
          message => { if (live) setState({ status: 'error', message, rows: [] }); },
        );
        return () => { live = false; };
      }, [provider.provider, provider.settingsNs, provider.declared, configured, tick, services]);

      useEffect(() => {
        const dispose = services.subscribe(() => bump());
        return () => { if (typeof dispose === 'function') dispose(); };
      }, [services]);

      if (configured !== true || provider.settingsNs !== SETTINGS_NS) return null;

      /**
       * One checkbox flip: apply optimistically, write through the settings
       * service, then re-read so tags follow the Host; failures roll back.
       */
      const onToggle = async (row, wantImage) => {
        setError('');
        setSaving(row.id);
        const before = state.rows;
        setState(current => ({
          ...current,
          rows: current.rows.map(item => (item.id === row.id ? { ...item, image: wantImage, source: 'override' } : item)),
        }));
        try {
          const outcome = await services.write(provider, state, row, wantImage);
          if (!outcome.ok) {
            setState(current => ({ ...current, rows: before }));
            setError(outcome.conflict ? t('conflict') : fill(t('saveError'), 'message', outcome.message));
            if (outcome.conflict) bump();
            return;
          }
          try {
            setState(await services.read(provider));
          } catch (message) {
            setError(fill(t('loadError'), 'message', String(message)));
          }
        } catch (message) {
          setState(current => ({ ...current, rows: before }));
          setError(fill(t('saveError'), 'message', String(message)));
        } finally {
          setSaving('');
        }
      };

      const disabled = state.status !== 'ready' || !state.writable || saving !== '';
      const needle = query.trim().toLowerCase();
      const visible = useMemo(() => (needle === ''
        ? state.rows
        : state.rows.filter(row => row.id.toLowerCase().includes(needle)
          || row.name.toLowerCase().includes(needle))),
      [state.rows, needle]);
      const showFilter = state.status === 'ready' && state.rows.length > FILTER_THRESHOLD;

      const items = state.status === 'ready' ? visible.map(row => (
        h('label', {
          key: row.id,
          className: `dsamic-row${disabled ? ' dsamic-rowDisabled' : ''}`,
          title: row.id,
        },
        h('input', {
          type: 'checkbox',
          className: 'dsamic-check',
          checked: row.image,
          disabled: disabled || saving === row.id,
          'aria-label': `${t('supportImage')} ${row.id}`,
          onChange: event => { void onToggle(row, event.target.checked); },
        }),
        h('span', { className: 'dsamic-name' }, row.name),
        row.name !== row.id ? h('code', { className: 'dsamic-id' }, row.id) : null,
        h('span', {
          className: 'dsamic-tag',
          title: row.source === 'override' ? t('tagOverrideTitle') : t('tagInheritedTitle'),
        }, row.source === 'override' ? t('tagOverride') : t('tagInherited')),
        )
      )) : [];

      return (
        h('section', { className: 'dsamic-panel', 'aria-label': t('title') },
        h('style', null, CSS),
        h('div', { className: 'dsamic-head' },
        h('span', { className: 'dsamic-title' }, t('title')),
        h('p', { className: 'dsamic-hint' }, t('hint')),
        ),
        state.status === 'loading'
          ? h('p', { className: 'dsamic-empty', role: 'status' }, t('loading'))
          : null,
        state.status === 'error'
          ? h('p', { className: 'dsamic-msg', role: 'alert' }, fill(t('loadError'), 'message', state.message))
          : null,
        state.status === 'ready' && state.rows.length === 0
          ? h('p', { className: 'dsamic-empty' }, state.refusal === undefined ? t('empty') : fill(t('loadError'), 'message', state.refusal))
          : null,
        showFilter
          ? h('input', {
            type: 'search',
            className: 'dsamic-filter',
            value: query,
            placeholder: t('filter'),
            'aria-label': t('filter'),
            onChange: event => { setQuery(event.target.value) },
          })
          : null,
        state.status === 'ready' && state.rows.length > 0
          ? h('div', { className: 'dsamic-list', role: 'group', 'aria-label': t('title') }, items)
          : null,
        showFilter && visible.length === 0
          ? h('p', { className: 'dsamic-empty' }, t('filterNone'))
          : null,
        state.status === 'ready' && !state.writable
          ? h('p', { className: 'dsamic-warn' }, t('readOnly'))
          : null,
        error !== '' ? h('p', { className: 'dsamic-msg', role: 'alert' }, error) : null,
        )
      );
    }

    /** Theme-token styles only; classes are prefixed and travel with the component. */
    const CSS = [
      '.dsamic-panel{display:flex;flex-direction:column;gap:8px;padding-top:12px;border-top:0.5px solid var(--dsw-alias-border-l2);}',
      '.dsamic-head{display:flex;flex-direction:column;gap:2px;}',
      '.dsamic-title{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary);}',
      '.dsamic-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dsamic-list{display:flex;flex-direction:column;gap:2px;max-height:264px;overflow-y:auto;}',
      '.dsamic-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:2px 6px;border-radius:var(--dsw-radius-lg);cursor:pointer;}',
      '@media (hover: hover){.dsamic-row:not(.dsamic-rowDisabled):hover{background:var(--dsw-alias-interactive-bg-hover);}}',
      '.dsamic-rowDisabled{cursor:default;}',
      '.dsamic-check{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-button-primary-fill);cursor:pointer;}',
      '.dsamic-check:disabled{cursor:default;}',
      '.dsamic-name{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dsamic-id{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.dsamic-tag{flex:none;margin-left:auto;padding:1px 6px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-xs);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}',
      '.dsamic-filter{box-sizing:border-box;width:100%;max-width:240px;height:28px;padding:0 10px;font-size:12px;color:var(--dsw-alias-label-primary);background:none;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);}',
      '.dsamic-filter::placeholder{color:var(--dsw-alias-label-tertiary);}',
      '.dsamic-filter:focus{outline:none;border-color:var(--dsw-alias-button-primary-fill);}',
      '.dsamic-empty{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
      '.dsamic-warn{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label);}',
      '.dsamic-msg{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);}',
    ].join('');

    return {
      inject: ['slots', 'locale', 'remote', 'remote.llm', 'remote.settings'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'model-image-input: copy dictionaries');
        const t = ctx.locale.bind(NS);

        /** Installed-catalog answers by route; cleared when adapters change. */
        const catalogs = new Map();
        const catalogFor = (entry) => {
          if (entry.declared === true) return Promise.resolve({ models: undefined });
          let cached = catalogs.get(entry.provider);
          if (cached === undefined) {
            cached = ctx.remote.llm.discoverModels(entry.settingsNs, { provider: entry.provider })
              .then(
                answer => (answer.ok ? { models: answer.value } : { refusal: answer.error.message }),
                () => ({ refusal: 'model discovery failed' }),
              );
            catalogs.set(entry.provider, cached);
          }
          return cached;
        };

        /**
         * Read one provider's rows: the settings describe plus the route's
         * installed catalog, joined with the adapter's own input precedence.
         */
        async function read(entry) {
          const described = await ctx.remote.settings.describe();
          if (!described.ok) throw described.error.message;
          const nsView = described.value.namespaces.find(view => view.ns === entry.settingsNs);
          const { models: catalog, refusal } = await catalogFor(entry);
          const { rows, userModels, valueModels } = computeRows(nsView, entry, catalog);
          return {
            status: 'ready',
            writable: described.value.writable,
            revision: nsView?.revision,
            rows,
            userModels,
            valueModels,
            refusal,
          };
        }

        /**
         * One checkbox write as path ops against the stored user section.
         * `models` rewrites the array the official editor rewrites; a catalog
         * route without one gets the single `modelOverrides.<id>.input` leaf.
         */
        async function write(entry, state, row, wantImage) {
          const next = wantImage ? ['text', 'image'] : ['text'];
          let ops;
          if (row.write.kind === 'models') {
            const source = state.userModels ?? state.valueModels;
            const index = (source ?? []).findIndex(model => String(model?.id ?? '') === row.id);
            if (index === -1) return { ok: false, conflict: false, message: `model "${row.id}" is not in the stored list` };
            const models = source.map((model, at) => (at === index ? { ...model, input: next } : model));
            ops = [{ op: 'set', path: [...entry.settingsPath, 'models'], value: models }];
          } else {
            ops = [{ op: 'set', path: [...entry.settingsPath, 'modelOverrides', row.id, 'input'], value: next }];
          }
          const answer = await ctx.remote.settings.mutate(entry.settingsNs, ops, state.revision);
          if (!answer.ok) {
            return { ok: false, conflict: answer.error.code === 'settings/conflict', message: answer.error.message };
          }
          return { ok: true };
        }

        const services = {
          read,
          write,
          subscribe: (listener) => {
            const disposers = [
              // Only this namespace's writes matter here; other sections must
              // not flicker every provider card into a refresh.
              ctx.remote.$on('settings/document-updated', ns => { if (ns === SETTINGS_NS) listener() }),
              // An adapter change can move the installed catalog; drop the cache.
              ctx.remote.$on('llm/adapters-updated', () => { catalogs.clear(); listener() }),
            ];
            return () => { for (const dispose of disposers) dispose(); };
          },
        };

        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
          name: 'settings.models.provider-card',
          id: 'model-image-input',
          key: SETTINGS_NS,
          order: 10,
          inject: () => ({ t, services }),
        }, ImageInputPanel));
      },
    };
  },
});
