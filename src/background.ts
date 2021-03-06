/**

libmicro, an embeddable firewall for WebExtension
Copyright (C) 2017 jspenguin2017

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.

**/


/**

libmicro is compatible with

Chromium 62+
Chrome   62+
Opera    48+
Quantum  57+
Edge     16+ (libedgyfy required)


libmicro needs these permissions

<all_urls>
storage
unlimitedStorage
tabs
webNavigation
webRequest
webRequestBlocking


libmicro does not create other global variable other than its
namespace, Micro.
libmicro will prepend "libmicro_" to all extension storage entries.

This script is the background script of libmicro, it is expected
to run before other scripts of your extension.

**/


"use strict";


/**
 * libmicro main namespace.
 * @namespace
 */
namespace Micro {
    /**
     * Used instance names.
     * @var
     */
    let usedNames: string[] = [];

    /**
     * Tab store interfaces.
     * @interface
     */
    interface Tab<Frame> {
        [key: number]: Frame,
    }
    interface Frame {
        [key: number]: string,
    }

    /**
     * Asset interface.
     * @interface
     */
    interface Asset {
        name: string, // TODO Why not make name the key
        raw: string,
        payload: string,
    }

    /**
     * Filter types.
     * @enum
     */
    const enum FilterType { BLOCK, REDIRECT, REPLACE, INJECT } // TODO Add CSP

    /**
     * Type normalizer.
     * @const
     */
    interface TypeTable {
        [key: string]: string,
    }
    const TypeNormalizer: TypeTable = {
        "main_frame": "main_frame",
        "document": "main_frame",

        "sub_frame": "sub_frame",
        "subdocument": "sub_frame",
        "iframe": "sub_frame",

        "stylesheet": "stylesheet",
        "css": "stylesheet",

        "script": "script",
        "js": "script",

        "image": "image",
        "img": "image",

        "font": "font",

        "object": "object",
        "object-subrequest": "object",

        "xmlhttprequest": "xmlhttprequest",
        "xhr": "xmlhttprequest",

        "ping": "ping",

        "csp_report": "csp_report",
        "csp-report": "csp_report",
        "cspreport": "csp_report",

        "media": "media",

        "websocket": "websocket",
        "socket": "websocket",

        "other": "other",
        "beacon": "other",
    };
    /**
     * Filter class.
     * @class
     */
    class Filter {
        /**
         * The main matcher of this filter.
         * @prop
         */
        private _re: RegExp;

        /**
         * Domain restriction.
         * @prop
         */
        private _domainMatch: string[] = [];
        private _domainUnmatch: string[] = [];
        /**
         * Type restriction.
         * @prop
         */
        private _typeMatch: string[] = [];
        private _typeUnmatch: string[] = [];

        /**
         * The type of this filter.
         * @readonly @prop
         */
        private _type: FilterType = FilterType.BLOCK;
        get type(): FilterType {
            return this._type;
        }

        /**
         * Extra data for the filter, depending the filter type, this can vary.
         * @readonly @prop
         */
        private _data: string = "";
        get data(): string {
            return this._data;
        }

        /**
         * Filter constructor.
         * @constructor
         * @param filter - The raw filter.
         */
        constructor(filter: string) {
            // Separate filter
            const optionAnchor: number = filter.lastIndexOf("$");
            let matcher: string;
            let options: string[];
            if (optionAnchor === -1) {
                matcher = filter;
                options = [];
            } else {
                matcher = filter.substring(0, optionAnchor).trim();
                options = filter.substring(optionAnchor + 1).trim().split(",");
                options = options.map((x: string): string => x.trim());
            }

            // Check white list
            if (matcher.startsWith("@@")) {
                throw new Error("libmicro does not handle white list");
            }

            // Parse options
            options.forEach((o: string): void => {
                // Negation
                const negated: boolean = o.startsWith("~");
                if (negated) {
                    o = o.substring(1);
                }

                // Ignored
                if (o === "libmicro" || o === "important") {
                    if (negated) {
                        throw new Error("libmicro does not accept negated 'libmicro' and 'important' option")
                    }
                    return;
                }

                // Party, error check is later
                if (o === "first-party") {
                    if (negated) {
                        this._domainUnmatch.push("'self'");
                    } else {
                        this._domainMatch.push("'self'");
                    }
                    return;
                }
                if (o === "third-party") {
                    if (negated) {
                        this._domainMatch.push("'self'");
                    } else {
                        this._domainUnmatch.push("'self'");
                    }
                    return;
                }

                // Action type
                if (o.startsWith("redirect=") || o.startsWith("replace=") || o.startsWith("inject=")) {
                    if (this._type !== FilterType.BLOCK) {
                        throw new Error("libmicro only accept one of 'redirect=', 'replace=', and 'inject=' option");
                    }
                }
                if (o.startsWith("redirect=")) {
                    this._type = FilterType.REDIRECT;
                    this._data = o.substring("redirect=".length);
                    return;
                }
                if (o.startsWith("replace=")) {
                    this._type = FilterType.REPLACE;
                    this._data = o.substring("replace=".length);
                    return;
                }
                if (o.startsWith("inject=")) {
                    this._type = FilterType.INJECT;
                    this._data = o.substring("inject=".length);
                    return;
                }

                // Domain restriction
                if (o.startsWith("domain=")) {
                    o = o.substring("domain=".length);
                    o.split(",").map((x: string): string => x.trim()).forEach((d: string): void => {
                        if (d.startsWith("~")) {
                            this._domainUnmatch.push(d.substring(1));
                        } else {
                            this._domainMatch.push(d);
                        }
                    });
                    return;
                }

                // Type restriction
                if (TypeNormalizer.hasOwnProperty(o)) {
                    if (negated) {
                        this._typeUnmatch.push(TypeNormalizer[o]);
                    } else {
                        this._typeMatch.push(TypeNormalizer[o]);
                    }
                    return;
                }

                // Error
                throw new Error("libmicro does not accept '" + o + "' option");
            });
            if (this._domainMatch.includes("'self'") && this._domainUnmatch.includes("'self'")) {
                throw new Error("libmicro only accepts one of 'first-party' and 'third-party' option");
            }
            if (this._domainMatch.includes("'self'") && this._domainMatch.length > 1) {
                throw new Error("libmicro only accepts one of 'first-party' and 'domain=' option");
            }
            if (this._domainUnmatch.includes("'self'") && this._domainUnmatch.length > 1) {
                throw new Error("libmicro only accepts one of 'third-party' and 'domain=' option");
            }

            // Quantum does not allow cancellation of document request
            if (/firefox/i.test(navigator.userAgent) && this._type === FilterType.BLOCK) {
                let typeMatched: boolean = true;
                if (this._typeMatch.length > 0) {
                    typeMatched = this._typeMatch.includes("main_frame") || this._typeMatch.includes("sub_frame");
                }
                let typeUnmatched: boolean = false;
                if (this._typeUnmatch.length > 0) {
                    typeUnmatched = this._typeUnmatch.includes("main_frame") || this._typeUnmatch.includes("sub_frame");
                }
                if (typeMatched && !typeUnmatched) {
                    this._type = FilterType.REDIRECT;
                    this._data = "libmicro-frame-blocked";
                }
            }

            // Parse main matcher
            if (/^\**$/.test(matcher)) {
                this._re = /[\s\S]/;
            } else if (matcher.length > 2 && matcher.startsWith("/") && matcher.endsWith("/")) {
                this._re = new RegExp(matcher.slice(1, -1), "i");
            } else {
                let reStrStart: string = "";
                let reStrEnd: string = "";

                // Start anchor
                if (matcher.startsWith("|")) {
                    reStrStart += "^";
                    matcher = matcher.substring(1);
                }
                // Domain anchor, must be processed after start anchor
                if (matcher.startsWith("|")) {
                    reStrStart += "https?:\\/\\/(?:[^./]+(?:\\.))*";
                    matcher = matcher.substring(1);
                }
                // End anchor
                if (matcher.endsWith("|")) {
                    reStrEnd = "$" + reStrEnd;
                    matcher = matcher.slice(0, -1);
                }

                // General RegExp escape
                matcher = matcher.replace(/[\\$+?.()|[\]{}]/g, '\\$&');
                // Wildcard matcher
                matcher = matcher.replace(/\*/g, "[\\s\\S]*");
                // Special character matcher
                matcher = matcher.replace(/\^/g, "(?:[/:?=&]|$)");

                this._re = new RegExp(reStrStart + matcher + reStrEnd, "i");
            }
        }

        /**
         * Check if a is a subdomain of b.
         * @method
         * @param a - The domain.
         * @param b - The origin.
         * @return whether a is a subdomain of b.
         */
        private _domCmp(a: string, b: string): boolean {
            return a.endsWith(b) && (a.length === b.length || a.charAt(a.length - b.length - 1) === ".");
        }
        /**
         * Check if a and b are part of the same origin.
         * @method
         * @param a - A domain.
         * @param b - Another domain.
         * @return Whether these two domains are of the same origin.
         */
        private _sameOrigin(a: string, b: string): boolean {
            if (a.length >= b.length) {
                return this._domCmp(a, b);
            } else {
                return this._domCmp(b, a);
            }
        }

        /**
         * Perform a match.
         * @method
         * @param requester - The requester URL.
         * @param destination - The requested URL.
         * @param type - The type of requested resources.
         * @return Whether this filter matches the request.
         */
        private readonly _domainExtractor: RegExp = /^https?:\/\/([^/]+)/;
        public match(requester: string, destination: string, type: string): boolean {
            // Process domain
            let requesterDomain: string | string[] | null = this._domainExtractor.exec(requester);
            if (requesterDomain === null) {
                return false;
            } else {
                requesterDomain = requesterDomain[1];
            }

            let destinationDomain: string | string[] | null = this._domainExtractor.exec(destination);
            if (destinationDomain === null) {
                return false;
            } else {
                destinationDomain = destinationDomain[1];
            }

            // Check party
            if (this._domainMatch[0] === "'self'" && !this._sameOrigin(requesterDomain, destinationDomain)) {
                return false;
            }
            if (this._domainUnmatch[0] === "'self'" && this._sameOrigin(requesterDomain, destinationDomain)) {
                return false;
            }

            // Check type restriction
            let typeMatched: boolean = true;
            if (this._typeMatch.length > 0) {
                typeMatched = this._typeMatch.includes(type);
            }
            let typeUnmatched: boolean = false;
            if (this._typeUnmatch.length > 0) {
                typeUnmatched = this._typeUnmatch.includes(type);
            }
            if (!typeMatched || typeUnmatched) {
                return false;
            }

            // Check domain restriction
            let domainMatched: boolean = true;
            if (this._domainMatch.length > 0) {
                domainMatched = this._domainMatch.some((d: string): boolean => {
                    // @ts-ignore Type is safe
                    return this._sameOrigin(requesterDomain, d);
                });
            }
            let domainUnmatched: boolean = false;
            if (this._domainUnmatch.length > 0) {
                domainUnmatched = this._domainUnmatch.some((d: string): boolean => {
                    // @ts-ignore
                    return this._sameOrigin(requesterDomain, d);
                });
            }
            if (!domainMatched || domainUnmatched) {
                return false;
            }

            // Apply main matcher
            return this._re.test(destination);
        }
    }

    /**
     * Chrome storage payload interface.
     * @interface
     */
    interface ChromeStoragePayload {
        [key: string]: string
    }
    /**
     * Before request event decision.
     * @interface
     */
    interface BeforeRequestDecision {
        redirectUrl?: string,
        cancel?: boolean,
    }
    /**
     * libmicro main class.
     * @class
     */
    export class Micro {
        /**
         * The name of this instance of libmicro.
         * @prop
         */
        private _name: string = "";
        /**
         * Constructor.
         * @constructor
         * @param [name=""] - The name of this instance, one name can be constructed once.
         */
        constructor(name: string = "") {
            if (usedNames.includes(name)) {
                throw new Error("This instance was already constructed");
            }

            usedNames.push(name);
            this._name = name;
        }

        /**
         * Whether libmicro is initialized.
         * @readonly @prop
         */
        private _initialized: boolean = false;
        get initialized() {
            return this._initialized;
        }

        /**
         * Whether debug mode is activated.
         * @prop
         */
        public debug: boolean = false;

        /**
         * Filters and assets.
         * @prop
         */
        private _assets: Asset[] = [];
        private _filters: Filter[] = [];

        /**
         * Tab store.
         * @prop
         */
        private _tabs: Tab<Frame> = {};

        /**
         * Event listeners with keyword this bound to them.
         * @prop
         */
        private _thisOnCommitted: Function | undefined = undefined;
        private _thisOnRemoved: Function | undefined = undefined;
        private _thisOnBeforeRequest: Function | undefined = undefined;

        /**
         * Initialize or reinitialize this libmicro instance.
         * @method
         */
        public async init(): Promise<void> {
            // Teardown if needed
            if (this._initialized) {
                this.teardown();
            }
            this._initialized = true;

            // Load assets and filters
            let assets: string = "";
            let filters: string = "";
            try {
                await new Promise((resolve: Function, reject: Function): void => {
                    chrome.storage.local.get([
                        "libmicro_assets_" + this._name,
                        "libmicro_filters_" + this._name,
                    ], (items: ChromeStoragePayload): void => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            assets = items["libmicro_assets_" + this._name] || "";
                            filters = items["libmicro_filters_" + this._name] || "";
                            resolve();
                        }
                    });
                });
            } catch (e) {
                console.error("libmicro could not read database, an empty database will be used");
                console.error(e);
            }

            // Parse assets
            let assetBuffer: string[] = [];
            assets += "\n"; // In case there is not a trailing new line
            assets.split("\n").forEach((line: string) => {
                line = line.trim();
                if (line.startsWith("#")) {
                    return;
                }

                if (line.length === 0) {
                    if (assetBuffer.length > 0) {
                        // @ts-ignore Length of buffer array is already checked
                        const meta: string[] = assetBuffer.shift().split(" ");
                        if (meta.length !== 2) {
                            console.error("libmicro could not parse an asset, syntax error near '" + meta.join(" ") + "'");
                            assetBuffer = [];
                            return;
                        }
                        const raw: string = assetBuffer.join("");
                        let payload: string = "data:" + meta[1];
                        if (meta[1].includes(";base64")) {
                            payload += "," + raw;
                        } else {
                            payload += ";base64," + btoa(raw);
                        }

                        this._assets.push({
                            name: meta[0],
                            raw: raw,
                            payload: payload,
                        });

                        assetBuffer = [];
                    }
                } else {
                    assetBuffer.push(line);
                }
            });

            // Parse filters
            let invalidFilters: number = 0;
            filters.split("\n").forEach((filter: string): void => {
                filter = filter.trim();
                if (filter.length === 0) {
                    return;
                }
                if (filter.charAt(0) === "!") {
                    return;
                }
                if (filter.charAt(0) === "#" && filter.charAt(1) !== "#") {
                    return;
                }

                try {
                    this._filters.push(new Filter(filter));
                } catch (e) {
                    // Do not abort, as I do not want one bad filter to crash everything
                    console.error("libmicro failed to parse '" + filter + "'");
                    console.error(e);
                }
            });
            if (invalidFilters > 0) {
                console.error("libmicro could not parse " + invalidFilters.toString() + " of the filters");
            }

            // Query existing tabs
            try {
                await new Promise((resolve: Function, reject: Function): void => {
                    let runningQueries: number = 0;

                    chrome.tabs.query({}, (existingTabs: chrome.tabs.Tab[]): void => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        }

                        for (let i = 0; i < existingTabs.length; i++) {
                            const tid: number | undefined = existingTabs[i].id;
                            if (typeof tid === "undefined") {
                                continue;
                            }
                            if (tid === chrome.tabs.TAB_ID_NONE) {
                                continue;
                            }

                            if (!this._tabs[tid]) {
                                this._tabs[tid] = {};
                            }
                            // @ts-ignore Permission "tabs" is required so the url will be present
                            this._tabs[tid][0] = this._tabs[tid][0] || existingTabs[i].url;

                            runningQueries++;
                            chrome.webNavigation.getAllFrames({ tabId: tid }, (frames: chrome.webNavigation.GetAllFrameResultDetails[] | null): void => {
                                if (chrome.runtime.lastError) {
                                    // Can be caused by race condition, just ignore
                                    return;
                                }

                                if (this._tabs[tid]) {
                                    // @ts-ignore Argument will only be null when chrome.runtime.lastError is set
                                    for (let ii = 0; ii < frames.length; ii++) {
                                        // @ts-ignore
                                        const fid: number = frames[ii].frameId;
                                        // @ts-ignore
                                        this._tabs[tid][fid] = this._tabs[tid][fid] || frames[ii].url;
                                    }
                                }

                                runningQueries--;
                                if (runningQueries === 0) {
                                    resolve();
                                }
                            });
                        }
                    });
                });
            } catch (e) {
                console.error("libmicro could not load existing tabs, an empty tab store will be used");
                console.error(e);
            }

            // Bind event handlers
            if (typeof this._thisOnCommitted === "undefined") {
                this._thisOnCommitted = this._onCommitted.bind(this);
                this._thisOnRemoved = this._onRemoved.bind(this);
                this._thisOnBeforeRequest = this._onBeforeRequest.bind(this);
            }
            // @ts-ignore Type is safe
            chrome.webNavigation.onCommitted.addListener(this._thisOnCommitted);
            // @ts-ignore
            chrome.tabs.onRemoved.addListener(this._thisOnRemoved);
            // @ts-ignore
            chrome.webRequest.onBeforeRequest.addListener(this._thisOnBeforeRequest, { urls: ["<all_urls>"] }, ["blocking"]);
        }
        /**
         * Teardown this libmicro instance.
         * @method
         */
        public teardown(): void {
            if (!this._initialized) {
                throw new Error("libmicro is not initialized");
            }

            this._initialized = false;
            this._assets = [];
            this._filters = [];
            this._tabs = {};

            // @ts-ignore Type is safe
            chrome.webNavigation.onCommitted.removeListener(this._thisOnCommitted);
            // @ts-ignore
            chrome.tabs.onRemoved.removeListener(this._thisOnRemoved);
            // @ts-ignore
            chrome.webRequest.onBeforeRequest.removeListener(this._thisOnBeforeRequest);
        }

        /**
         * Set filters, will take effect on the next initialization.
         * @async @function
         * @param filters - The filters text.
         */
        public setFilters(filters: string): Promise<undefined> {
            return new Promise((resolve: Function, reject: Function): void => {
                let payload: ChromeStoragePayload = {};
                payload["libmicro_filters_" + this._name] = filters;

                chrome.storage.local.set(payload, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        }
        /**
         * Set assets, will take effect on the next initialization.
         * @async @function
         * @param assets - The assets text.
         */
        public setAssets(assets: string): Promise<undefined> {
            return new Promise((resolve: Function, reject: Function): void => {
                let payload: ChromeStoragePayload = {};
                payload["libmicro_assets_" + this._name] = assets;

                chrome.storage.local.set(payload, () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        }

        /**
         * Get the URL of a frame of a tab.
         * @private @method
         * @param tab - The ID of the tab.
         * @param frame - The ID of the frame.
         * @return {string} The URL of the tab, or an empty string if it is not known.
         */
        private _getTabURL(tab: number, frame: number): string {
            if (this._tabs[tab]) {
                return this._tabs[tab][frame] || "";
            } else {
                return "";
            }
        }
        /**
         * Find asset by name.
         * @param name - The asset to find.
         * @return The asset or null if the asset could not be found.
         */
        private _findAsset(name: string): Asset | null {
            for (let i = 0; i < this._assets.length; i++) {
                if (this._assets[i].name === name) {
                    return this._assets[i];
                }
            }
            return null;
        }

        /**
         * Committed event handler.
         * @private @method
         * @param details - Event details.
         */
        private _onCommitted(details: chrome.webNavigation.WebNavigationTransitionCallbackDetails): void {
            // Update tab store
            if (!this._tabs[details.tabId]) {
                this._tabs[details.tabId] = {};
            }
            this._tabs[details.tabId][details.frameId] = details.url;

            // Inject scriptlets
            for (let i = 0; i < this._filters.length; i++) {
                const filter = this._filters[i];

                if (filter.type !== FilterType.INJECT) {
                    // TODO Optimize this
                    continue;
                }

                if (filter.match(details.url, details.url, "main_frame")) {
                    let asset: Asset | null = this._findAsset(filter.data);
                    if (asset) {
                        chrome.tabs.executeScript(details.tabId, {
                            frameId: details.frameId,
                            code: "Micro.exec(`" + asset.raw.replace(/`/g, "\\`") + "`);",
                            runAt: "document_start",
                        });
                    } else {
                        console.error("libmicro could not find asset '" + filter.data + "', the scriptlet is not injected");
                    }
                }
            }
        }
        /**
         * Removed event handler.
         * @private @method
         * @param id - The ID of the tab that was just closed.
         */
        private _onRemoved(id: number): void {
            delete this._tabs[id];
        }
        /**
         * Before request event handler.
         * @private @method
         * @param details - The event details
         * @return The decision.
         */
        private _onBeforeRequest(details: chrome.webRequest.WebRequestBodyDetails): BeforeRequestDecision | void {
            // @ts-ignore Quantum has these properties
            let requester: string | undefined = details.documentUrl || details.originUrl;
            if (!requester) {
                requester = this._getTabURL(details.tabId, details.frameId);
            }

            if (requester.length > 0 && !/^https?:\/\//.test(requester)) {
                return;
            }

            for (let i = 0; i < this._filters.length; i++) {
                const filter = this._filters[i];

                if (filter.type === FilterType.INJECT) {
                    // TODO Optimize this
                    continue;
                }

                if (filter.match(requester, details.url, details.type)) {
                    switch (filter.type) {
                        case FilterType.BLOCK:
                            if (this.debug) {
                                console.log("libmicro canceled a request to '" + details.url + "'");
                            }
                            return { cancel: true };

                        case FilterType.REDIRECT:
                            let asset: Asset | null = this._findAsset(filter.data);
                            if (asset) {
                                if (this.debug) {
                                    console.log("libmicro performed a redirect, from '" + details.url + "' to '" + filter.data + "'");
                                }
                                return { redirectUrl: asset.payload };
                            } else {
                                if (this.debug) {
                                    console.error("libmicro could not find asset '" + filter.data + "', the request is blocked as a fallback");
                                }
                                return { cancel: true };
                            }

                        case FilterType.REPLACE:
                            // Only possible in Quantum
                            // TODO Implement this
                            console.warn("libmicro does not yet have implementation of request replacement");
                            break;
                    }
                }
            }
        }
    }
}
