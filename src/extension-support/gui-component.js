class GUIComponent extends window.HTMLElement {
    constructor () {
        super();

        this._state = {};

        this.props = {};
        const observed = this.constructor.observedAttributes;
        const attrNames = new Set(this.getAttributeNames().concat(observed));
        if (attrNames.length > 0) {
            Object.defineProperties(
                this.props,
                Object.fromEntries(Array.from(attrNames).map(name => [
                    name,
                    {get: () => this.getAttribute(name)}
                ]))
            );
        }
    }

    get state () {
        return this._state;
    }

    set state (newState) {
        Object.assign(this._state, newState);
    }

    emit (eventName, detail = {}, option = {}) {
        this.dispatchEvent(new CustomEvent(
            eventName.toLowerCase(),
            Object.assign(option, {detail})
        ));
    }

    connectedCallback () {
        const template = document.createElement('template');
        template.innerHTML = this.render()
            .replace(/\bon(\w+)="this\.([\w_]+)"/g, 'data-event data-on$1="$2"'); // onevent -> data-onevent
        this.appendChild(template.content.cloneNode(true));

        // binding element's id
        const idElements = this.querySelectorAll('*[id]');
        if (idElements.length > 0) {
            Object.defineProperties(
                this,
                Object.fromEntries(Array.from(idElements).map(elem => [
                    elem.id.replace(/-(\w)/g, m => m[1].toUpperCase()), // id-string -> idString
                    {get: () => elem}
                ]))
            );
        }

        // binding event
        const eventElements = this.querySelectorAll('[data-event]');
        if (eventElements.length > 0) {
            eventElements.forEach(elem => {
                elem.removeAttribute('data-event');
                elem.dataset.listening = true;
                Object.keys(elem.dataset)
                    .filter(key => /^on\w+$/i.test(key))
                    .forEach(key => {
                        const eventName = key.slice(2).toLowerCase(); // remove 'on'
                        const methodName = elem.dataset[key];
                        if (this[methodName]) {
                            this[methodName] = this[methodName].bind(this);
                            elem.addEventListener(eventName, this[methodName]);
                        }
                    });
            });
        }
    }

    disconnectedCallback () {
        const eventElements = this.querySelectorAll('[data-listening]');
        if (eventElements.length > 0) {
            eventElements.forEach(elem => {
                Object.keys(elem.dataset)
                    .filter(key => /^on\w+$/i.test(key))
                    .forEach(key => {
                        const eventName = key.slice(2);
                        const methodName = elem.dataset[key];
                        if (this[methodName]) {
                            elem.removeEventListener(eventName, this[methodName]);
                        }
                    });
            });
        }
        this.removeChild(this.firstChild);
    }

    adoptedCallback () {
        return;
    }

    attributeChangedCallback (/* name, oldValue, newValue */) {
        return;
    }

    stateChangedCallback (/* name, oldValue, newValue */) {
        return;
    }

    setState (name, newValue) {
        if (typeof this.state[name] !== 'undefined') {
            const oldValue = this.state[name];
            this.state[name] = newValue;
            this.stateChangedCallback(name, oldValue, newValue);
        }
    }

    render () {
        return '';
    }
}

module.exports = GUIComponent;
