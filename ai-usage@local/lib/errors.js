// User-facing provider errors. `message` is shown verbatim in the dropdown menu.

export const ErrorKind = Object.freeze({
    AUTH: 'auth_error',
    NETWORK: 'network_error',
    NOT_INSTALLED: 'not_installed',
    DISCONNECTED: 'disconnected',
    TIMEOUT: 'timeout',
    NO_DATA: 'no_data',
    CANCELLED: 'cancelled',
});

export class ProviderError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'ProviderError';
        this.kind = kind;
    }
}

export function toProviderError(error, fallbackMessage) {
    return error instanceof ProviderError
        ? error
        : new ProviderError(ErrorKind.NETWORK, fallbackMessage);
}
