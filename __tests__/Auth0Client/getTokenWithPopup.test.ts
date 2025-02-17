import 'fast-text-encoding';
import unfetch from 'unfetch';
import { verify } from '../../src/jwt';
import { MessageChannel } from 'worker_threads';
import * as utils from '../../src/utils';
import * as scope from '../../src/scope';

// @ts-ignore

import {
  assertPostFn,
  fetchResponse,
  getTokenWithPopupFn,
  loginWithPopupFn,
  setupFn,
  setupMessageEventLister
} from './helpers';

import {
  TEST_ACCESS_TOKEN,
  TEST_CLIENT_ID,
  TEST_CODE,
  TEST_CODE_CHALLENGE,
  TEST_CODE_VERIFIER,
  TEST_ID_TOKEN,
  TEST_REDIRECT_URI,
  TEST_REFRESH_TOKEN,
  TEST_STATE
} from '../constants';

import { Auth0ClientOptions } from '../../src';
import { DEFAULT_AUTH0_CLIENT } from '../../src/constants';

jest.mock('unfetch');
jest.mock('es-cookie');
jest.mock('../../src/jwt');
jest.mock('../../src/worker/token.worker');

const mockWindow = <any>global;
const mockFetch = (mockWindow.fetch = <jest.Mock>unfetch);
const mockVerify = <jest.Mock>verify;
const assertPost = assertPostFn(mockFetch);
const loginWithPopup = loginWithPopupFn(mockWindow, mockFetch);
const getTokenWithPopup = getTokenWithPopupFn(mockWindow, mockFetch);

jest
  .spyOn(utils, 'bufferToBase64UrlEncoded')
  .mockReturnValue(TEST_CODE_CHALLENGE);

jest.spyOn(utils, 'runPopup');

const setup = setupFn(mockVerify);

describe('Auth0Client', () => {
  const oldWindowLocation = window.location;

  beforeEach(() => {
    // https://www.benmvp.com/blog/mocking-window-location-methods-jest-jsdom/
    delete window.location;
    window.location = Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(oldWindowLocation),
        assign: {
          configurable: true,
          value: jest.fn()
        }
      }
    ) as Location;
    // --

    mockWindow.open = jest.fn();
    mockWindow.addEventListener = jest.fn();
    mockWindow.crypto = {
      subtle: {
        digest: () => 'foo'
      },
      getRandomValues() {
        return '123';
      }
    };
    mockWindow.MessageChannel = MessageChannel;
    mockWindow.Worker = {};
    jest.spyOn(scope, 'getUniqueScopes');
    sessionStorage.clear();
  });

  afterEach(() => {
    mockFetch.mockReset();
    jest.clearAllMocks();
    window.location = oldWindowLocation;
  });

  describe('getTokenWithPopup()', () => {
    const localSetup = async (clientOptions?: Partial<Auth0ClientOptions>) => {
      const auth0 = setup(clientOptions);

      setupMessageEventLister(mockWindow, { state: TEST_STATE });

      mockFetch.mockResolvedValueOnce(
        fetchResponse(true, {
          id_token: TEST_ID_TOKEN,
          refresh_token: TEST_REFRESH_TOKEN,
          access_token: TEST_ACCESS_TOKEN,
          expires_in: 86400
        })
      );

      return auth0;
    };

    it('uses the cache when expires_in > constant leeway', async () => {
      const auth0 = setup();
      await loginWithPopup(auth0, undefined, undefined, {
        token: {
          response: { expires_in: 70 }
        }
      });

      mockFetch.mockReset();

      const token = await auth0.getTokenWithPopup();

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls `loginWithPopup` with the correct default options', async () => {
      const auth0 = await localSetup();
      expect(await auth0.getTokenWithPopup()).toEqual(TEST_ACCESS_TOKEN);
    });

    it('respects customized scopes', async () => {
      const auth0 = await localSetup({
        advancedOptions: {
          defaultScope: 'email'
        },
        scope: 'read:email'
      });

      const config = {
        popup: {
          location: {
            href: ''
          },
          close: jest.fn()
        }
      };

      expect(await auth0.getTokenWithPopup({}, config)).toEqual(
        TEST_ACCESS_TOKEN
      );

      expect(config.popup.location.href).toMatch(
        /openid%20email%20read%3Aemail/
      );
    });

    it('passes custom login options', async () => {
      const auth0 = await localSetup();

      const loginOptions = {
        audience: 'other-audience',
        screen_hint: 'signup'
      };

      const config = {
        popup: {
          location: {
            href: ''
          },
          close: jest.fn()
        }
      };

      await auth0.getTokenWithPopup(loginOptions, config);

      expect(config.popup.location.href).toMatch(/other-audience/);
      expect(config.popup.location.href).toMatch(/screen_hint/);
    });

    it('should use form data if useFormData is true', async () => {
      const auth0 = await localSetup({
        useFormData: true
      });

      const loginOptions = {
        audience: 'other-audience',
        screen_hint: 'signup'
      };

      const config = {
        popup: {
          location: {
            href: ''
          },
          close: jest.fn()
        }
      };

      await auth0.getTokenWithPopup(loginOptions, config);

      assertPost(
        'https://auth0_domain/oauth/token',
        {
          redirect_uri: TEST_REDIRECT_URI,
          client_id: TEST_CLIENT_ID,
          code_verifier: TEST_CODE_VERIFIER,
          grant_type: 'authorization_code'
        },
        {
          'Auth0-Client': btoa(JSON.stringify(DEFAULT_AUTH0_CLIENT)),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        0,
        false
      );
    });

    it('can use the global audience', async () => {
      const auth0 = await localSetup({
        audience: 'global-audience'
      });

      const config = {
        popup: {
          location: {
            href: ''
          },
          close: jest.fn()
        }
      };

      await auth0.getTokenWithPopup({}, config);

      expect(config.popup.location.href).toMatch(/global-audience/);
    });

    it('refreshes the token when no cache available', async () => {
      const auth0 = setup();
      const token = await getTokenWithPopup(auth0);

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('refreshes the token when cache available without access token', async () => {
      const auth0 = setup();
      await loginWithPopup(auth0, undefined, undefined, {
        token: {
          response: { expires_in: 70, access_token: null }
        }
      });

      mockFetch.mockReset();

      const token = await getTokenWithPopup(auth0);

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('refreshes the token when expires_in < constant leeway', async () => {
      const auth0 = setup();
      await loginWithPopup(auth0, undefined, undefined, {
        token: {
          response: { expires_in: 50 }
        }
      });

      mockFetch.mockReset();

      const token = await getTokenWithPopup(auth0);

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes the token when ignoreCache set to true', async () => {
      const auth0 = setup();
      await loginWithPopup(auth0, undefined, undefined, {
        token: {
          response: { expires_in: 70 }
        }
      });

      mockFetch.mockReset();

      const token = await getTokenWithPopup(auth0, { ignoreCache: true });

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('uses the cache when expires_in > constant leeway & refresh tokens are used', async () => {
      const auth0 = setup({
        useRefreshTokens: true
      });

      await loginWithPopup(auth0, undefined, undefined, {
        token: {
          response: { expires_in: 70 }
        }
      });

      mockFetch.mockReset();

      const token = await getTokenWithPopup(auth0);

      expect(token).toBe(TEST_ACCESS_TOKEN);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
