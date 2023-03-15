export function parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

export function isAdmin(jwtStr) {
    var jwt = parseJwt(jwtStr);
    return jwt.role_guid == 'R04';
}

export function parseCookies(allCookies) {
    if(!allCookies) {
        return null;
    }
    let cookies = {};

    const cookiesArray = allCookies.split(';');

    cookiesArray.forEach((cookie) => {
        const [key, value] = cookie.trim().split('=');
        cookies[key] = decodeURIComponent(value);
    });

    return cookies;
}
