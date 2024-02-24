import { DEV } from 'esm-env';
import {
	current_component_context,
	current_effect,
	execute_effect,
	flush_local_render_effects,
	schedule_effect
} from '../runtime.js';
import { remove } from '../reconciler.js';
import {
	DIRTY,
	MANAGED,
	RENDER_EFFECT,
	EFFECT,
	PRE_EFFECT,
	INERT,
	ROOT_EFFECT,
	DESTROYED
} from '../constants.js';

/**
 * @param {import('./types.js').EffectType} type
 * @param {(() => void | (() => void))} fn
 * @param {boolean} sync
 * @param {boolean} schedule
 * @returns {import('#client').Effect}
 */
function create_effect(type, fn, sync, schedule) {
	/** @type {import('#client').Effect} */
	const signal = {
		d: null,
		f: type | DIRTY,
		l: 0,
		i: fn,
		r: null,
		v: null,
		ctx: current_component_context,
		y: null,
		in: null,
		out: null,
		dom: null,
		ran: false,
		parent: current_effect,
		children: null
	};

	if (DEV) {
		// @ts-expect-error
		signal.inspect = new Set();
	}

	if (current_effect !== null) {
		signal.l = current_effect.l + 1;

		if (current_effect.children === null) {
			current_effect.children = [signal];
		} else {
			current_effect.children.push(signal);
		}
	}

	if (schedule) {
		schedule_effect(signal, sync);
	}

	return signal;
}

/**
 * Internal representation of `$effect.active()`
 * @returns {boolean}
 */
export function effect_active() {
	return current_effect ? (current_effect.f & MANAGED) === 0 : false;
}

/**
 * Internal representation of `$effect(...)`
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function user_effect(fn) {
	if (current_effect === null) {
		throw new Error(
			'ERR_SVELTE_ORPHAN_EFFECT' +
				(DEV ? ': The Svelte $effect rune can only be used during component initialisation.' : '')
		);
	}

	const apply_component_effect_heuristics =
		current_effect.f & RENDER_EFFECT &&
		current_component_context !== null &&
		!current_component_context.m;

	const effect = create_effect(EFFECT, fn, false, !apply_component_effect_heuristics);

	if (apply_component_effect_heuristics) {
		const context = /** @type {import('#client').ComponentContext} */ (current_component_context);
		(context.e ??= []).push(effect);
	}

	return effect;
}

/**
 * Internal representation of `$effect.root(...)`
 * @param {() => void | (() => void)} fn
 * @returns {() => void}
 */
export function user_root_effect(fn) {
	const effect = create_effect(RENDER_EFFECT | ROOT_EFFECT, fn, true, true);
	return () => {
		destroy_effect(effect);
	};
}

/**
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function effect(fn) {
	return create_effect(EFFECT, fn, false, true);
}

/**
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function managed_effect(fn) {
	return create_effect(EFFECT | MANAGED, fn, false, true);
}

/**
 * @param {() => void | (() => void)} fn
 * @param {boolean} sync
 * @returns {import('#client').Effect}
 */
export function managed_pre_effect(fn, sync) {
	return create_effect(PRE_EFFECT | MANAGED, fn, sync, true);
}

/**
 * Internal representation of `$effect.pre(...)`
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function pre_effect(fn) {
	if (current_effect === null) {
		throw new Error(
			'ERR_SVELTE_ORPHAN_EFFECT' +
				(DEV
					? ': The Svelte $effect.pre rune can only be used during component initialisation.'
					: '')
		);
	}
	const sync = current_effect !== null && (current_effect.f & RENDER_EFFECT) !== 0;
	return create_effect(
		PRE_EFFECT,
		() => {
			const val = fn();
			flush_local_render_effects();
			return val;
		},
		sync,
		true
	);
}

/**
 * This effect is used to ensure binding are kept in sync. We use a pre effect to ensure we run before the
 * bindings which are in later effects. However, we don't use a pre_effect directly as we don't want to flush anything.
 *
 * @param {() => void | (() => void)} fn
 * @returns {import('#client').Effect}
 */
export function invalidate_effect(fn) {
	return create_effect(PRE_EFFECT, fn, true, true);
}

/**
 * @param {() => void | (() => void)} fn
 * @param {boolean} managed
 * @param {boolean} sync
 * @returns {import('#client').Effect}
 */
export function render_effect(fn, managed = false, sync = true) {
	let flags = RENDER_EFFECT;
	if (managed) flags |= MANAGED;

	return create_effect(flags, fn, sync, true);
}

/**
 * @param {import('#client').Effect} effect
 * @param {() => void} done
 */
export function pause_effect(effect, done) {
	/** @type {import('#client').Transition[]} */
	const transitions = [];

	pause_children(effect, transitions, true);

	let remaining = transitions.length;

	if (remaining > 0) {
		const check = () => {
			if (!--remaining) {
				destroy_effect(effect);
				done();
			}
		};

		for (const transition of transitions) {
			transition.to(0, check);
		}
	} else {
		destroy_effect(effect);
		done();
	}
}

/**
 * @param {import('#client').Effect} effect
 * @param {import('#client').Transition[]} transitions
 * @param {boolean} local
 */
function pause_children(effect, transitions, local) {
	if ((effect.f & INERT) !== 0) return;
	effect.f |= INERT;

	if (typeof effect.v === 'function') {
		effect.v();
	}

	if (effect.out) {
		for (const transition of effect.out) {
			if (transition.global || local) {
				transitions.push(transition);
			}
		}
	}

	if (effect.children) {
		for (const child of effect.children) {
			pause_children(child, transitions, false); // TODO separate child effects from child deriveds
		}
	}
}

/**
 * @param {import('#client').Effect} effect TODO this isn't just block effects, it's deriveds etc too
 */
export function destroy_effect(effect) {
	if ((effect.f & DESTROYED) !== 0) return;
	effect.f |= DESTROYED;

	// TODO detach from parent effect

	// TODO distinguish between 'block effects' (?) which own their own DOM
	// and other render effects
	if (effect.dom) {
		// TODO skip already-detached DOM
		remove(effect.dom);
	}

	if (effect.children) {
		for (const child of effect.children) {
			destroy_effect(child);
		}
	}
}

/**
 * @param {import('#client').Effect} effect
 */
export function resume_effect(effect) {
	resume_children(effect, true);
}

/**
 * @param {import('#client').Effect} effect
 * @param {boolean} local
 */
function resume_children(effect, local) {
	if ((effect.f & MANAGED) === 0) {
		execute_effect(effect);
	}

	if (effect.children) {
		for (const child of effect.children) {
			resume_children(child, false);
		}
	}

	effect.f ^= INERT;

	if (effect.in) {
		for (const transition of effect.in) {
			if (transition.global || local) {
				transition.to(1);
			}
		}
	}
}
