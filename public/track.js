(function() {
  if (window.FunnelTrack) return;

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // Extract root domain for cookie sharing across subdomains
  // e.g. "novaav.brenoxavier.com.br" → ".brenoxavier.com.br"
  var getRootDomain = function() {
    var parts = window.location.hostname.split('.');
    if (parts.length >= 3) {
      return '.' + parts.slice(-3).join('.');
    }
    if (parts.length === 2) {
      return '.' + parts.join('.');
    }
    return window.location.hostname;
  };

  var setCookie = function(name, value, days) {
    var d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    var domain = getRootDomain();
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;domain=' + domain + ';SameSite=Lax';
  };

  var deleteCookie = function(name) {
    var past = 'Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = name + '=;expires=' + past + ';path=/;domain=' + getRootDomain() + ';SameSite=Lax';
    document.cookie = name + '=;expires=' + past + ';path=/;SameSite=Lax';
  };

  var getCookie = function(name) {
    var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  };

  var getSessionId = function() {
    var sid = localStorage.getItem('funnel_track_session');
    if (!sid) {
      sid = 'sid_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      localStorage.setItem('funnel_track_session', sid);
    }
    return sid;
  };

  var getUrlParams = function() {
    var params = new URLSearchParams(window.location.search);
    
    // Save bx_click to localStorage
    var bxClick = params.get('bx_click');
    if (bxClick) {
      localStorage.setItem('bx_click', bxClick);
    }
    
    // UTMs como CONJUNTO (mesma regra de src/lib/utmCapture.ts):
    // URL com qualquer utm_* -> vale so a URL (campo ausente = null) e
    // sessionStorage + cookies (cross-subdomain, 30 dias) sao regravados
    // com o conjunto inteiro, apagando o que nao veio. URL sem utm_* ->
    // vale o conjunto guardado (sessionStorage se tiver algum, senao cookies).
    // URL so com a marca do rotator (utm_content=vN igual ao cm_variant, sem
    // outra utm_*) conta como URL sem utm_*: marca a versao, nao a origem.
    var content = params.get('utm_content');
    var variant = params.get('cm_variant');
    var soRotator = !!content && !!variant && /^v\d+$/i.test(content) &&
      content.toLowerCase() === variant.toLowerCase() &&
      UTM_KEYS.every(function(k) { return k === 'utm_content' || !params.get(k); });
    var result = {};
    var urlHasUtm = !soRotator && UTM_KEYS.some(function(k) { return !!params.get(k); });
    if (urlHasUtm) {
      UTM_KEYS.forEach(function(k) {
        var v = params.get(k);
        if (v) {
          sessionStorage.setItem(k, v);
          setCookie('ft_' + k, v, 30); // 30 days
        } else {
          sessionStorage.removeItem(k);
          deleteCookie('ft_' + k);
        }
        result[k] = v || null;
      });
    } else {
      var sessionHasUtm = UTM_KEYS.some(function(k) { return !!sessionStorage.getItem(k); });
      UTM_KEYS.forEach(function(k) {
        result[k] = (sessionHasUtm ? sessionStorage.getItem(k) : getCookie('ft_' + k)) || null;
      });
    }

    result.fbclid = params.get('fbclid');
    result.bx_click = localStorage.getItem('bx_click');
    return result;
  };

  var sendEvent = async function(eventType, value, leadData) {
    value = value || 0;
    leadData = leadData || {};
    var token = window.FUNNEL_TRACK_TOKEN;
    if (!token) {
      console.warn('FunnelTrack: Token not found. Set window.FUNNEL_TRACK_TOKEN before loading script.');
      return;
    }

    try {
      var API_URL = window.FUNNEL_TRACK_API_URL || 'https://SEU_PROJECT_REF.supabase.co/functions/v1/funnel-track';

      var urlParams = getUrlParams();
      var payload = {
        token: token,
        event_type: eventType,
        session_id: getSessionId(),
        url: window.location.href,
        referrer: document.referrer,
        value: value
      };

      // Merge URL params
      for (var key in urlParams) {
        payload[key] = urlParams[key];
      }
      // Merge lead data
      for (var lkey in leadData) {
        payload[lkey] = leadData[lkey];
      }

      await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (err) {
      console.error('FunnelTrack error:', err);
    }
  };

  window.FunnelTrack = {
    event: sendEvent,
    lead: function(email, phone) { return sendEvent('lead', 0, { email: email, phone: phone }); },
  };

  sendEvent('page_view');
})();
