import { tick } from 'svelte';
import { deferred } from '../../../../src/internal/shared/utils.js';
import { test } from '../../test';

/** @type {ReturnType<typeof deferred>} */
let d;

export default test({
	html: `<p>pending</p>`,

	get props() {
		d = deferred();

		return {
			promise: d.promise
		};
	},

	async test({ assert, target, component }) {
		d.resolve('cool');
		await Promise.resolve();
		await tick();
		assert.htmlEqual(target.innerHTML, '<p class="cool">hello</p>');

		d = deferred();
		component.promise = d.promise;
		assert.htmlEqual(target.innerHTML, '<p>pending</p>');

		d.resolve('neat');
		await Promise.resolve();
		await tick();
		assert.htmlEqual(target.innerHTML, '<p class="neat">hello</p>');
	}
});
